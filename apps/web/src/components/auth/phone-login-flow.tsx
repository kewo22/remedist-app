'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { normalizePhone, type PhoneOtpChannel } from '@remedist/shared';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField } from '@/components/common/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { clientAuthApi } from '@/lib/api/client-auth';
import { getErrorMessage, getRetryAfterSeconds, isApiError } from '@/lib/api/errors';
import { phoneOtpApi } from '@/lib/api/phone-otp';
import { completeClientSignIn } from '@/lib/auth/client-auth';
import { phoneCodeField, phoneField } from '@/lib/auth/schemas';
import { applyApiErrors } from '@/lib/forms';
import { formatCountdown, useCountdown } from '@/lib/hooks/use-countdown';
import { AuthCard, FormServerError } from './auth-card';
import { DevCodeHint } from './dev-code-hint';
import { TurnstileCheck } from './turnstile-check';

const PURPOSE = 'login';
/** Most clients are in Sri Lanka; the field still takes any country code. */
const DEFAULT_COUNTRY_PREFIX = '+94 ';
const linkClass = 'font-medium text-primary underline-offset-4 hover:underline';

const CHANNEL_LABEL: Record<PhoneOtpChannel, string> = { whatsapp: 'WhatsApp', sms: 'text message' };

interface Sent {
  /** Changes with every code sent, so the code step starts fresh for a new code. */
  id: number;
  /** Normalised (+<digits>). */
  phoneNumber: string;
  channel: PhoneOtpChannel;
  devCode: string | undefined;
}

type RequestOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * Sign in with a code sent to the client's phone: the number, then the code. A checked code gives
 * a phone verification token, which is exchanged for a session.
 */
export function PhoneLoginFlow({ next }: { next: string }) {
  const [sent, setSent] = useState<Sent | null>(null);
  // CHALLENGE_REQUIRED: show the security check, then repeat the request for this number with its token.
  const [challengeFor, setChallengeFor] = useState<string | null>(null);
  // An error from the request repeated after the check (the forms only see their own submits).
  const [retryError, setRetryError] = useState<string | null>(null);
  // The resend wait: the API's nextResendWaitSeconds after a send, or Retry-After from a 429.
  const wait = useCountdown();
  const nextQuery = `?next=${encodeURIComponent(next)}`;

  async function requestCode(phoneNumber: string, turnstileToken?: string): Promise<RequestOutcome> {
    setRetryError(null);
    try {
      const { data } = await phoneOtpApi.send({ phoneNumber, purpose: PURPOSE, turnstileToken });
      setChallengeFor(null);
      // A resend (straight away or after the security check) replaces the code step.
      if (sent) toast.success('We sent a new code.');
      setSent({ id: (sent?.id ?? 0) + 1, phoneNumber, channel: data.channel, devCode: data.devCode });
      wait.start(data.nextResendWaitSeconds);
      return { ok: true };
    } catch (error) {
      if (isApiError(error, 'CHALLENGE_REQUIRED')) {
        setChallengeFor(phoneNumber);
      } else {
        setChallengeFor(null);
        const retryAfter = getRetryAfterSeconds(error);
        if (retryAfter) wait.start(retryAfter);
      }
      return { ok: false, error };
    }
  }

  async function retryWithToken(phoneNumber: string, token: string) {
    const outcome = await requestCode(phoneNumber, token);
    if (!outcome.ok && !isApiError(outcome.error, 'CHALLENGE_REQUIRED')) setRetryError(getErrorMessage(outcome.error));
  }

  let challenge: ReactNode = null;
  if (challengeFor) {
    challenge = (
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <p className="text-sm">Please complete this quick security check, and we&apos;ll send the code.</p>
        {/* Keyed by number so a fresh widget (and a fresh single-use token) is used each time. */}
        <TurnstileCheck key={challengeFor} onToken={(token) => void retryWithToken(challengeFor, token)} />
      </div>
    );
  } else if (retryError) {
    challenge = (
      <p role="alert" className="text-sm text-destructive">
        {retryError}
      </p>
    );
  }

  const emailLink = (
    <p>
      Prefer your email?{' '}
      <Link href={`/login${nextQuery}`} className={linkClass}>
        Sign in with email
      </Link>
    </p>
  );

  if (sent) {
    return (
      <CodeStep
        key={sent.id}
        sent={sent}
        nextQuery={nextQuery}
        secondsLeft={wait.secondsLeft}
        requestCode={requestCode}
        challenge={challenge}
        challenging={challengeFor !== null}
        footer={emailLink}
        onBack={() => {
          setSent(null);
          setChallengeFor(null);
          setRetryError(null);
          // The resend wait is per number: another number may be sent straight away.
          wait.reset();
        }}
      />
    );
  }

  return (
    <AuthCard
      title="Sign in with your phone"
      description="We'll send a 6-digit code to your mobile by WhatsApp, or by text message."
      footer={emailLink}
    >
      <PhoneStep secondsLeft={wait.secondsLeft} requestCode={requestCode} challenging={challengeFor !== null} />
      {challenge}
    </AuthCard>
  );
}

const phoneSchema = z.object({ phoneNumber: phoneField });
type PhoneInput = z.input<typeof phoneSchema>;

function PhoneStep({
  secondsLeft,
  requestCode,
  challenging,
}: {
  secondsLeft: number;
  requestCode: (phoneNumber: string) => Promise<RequestOutcome>;
  challenging: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phoneNumber: DEFAULT_COUNTRY_PREFIX } satisfies PhoneInput,
  });

  async function onSubmit({ phoneNumber }: z.output<typeof phoneSchema>) {
    const outcome = await requestCode(normalizePhone(phoneNumber));
    // Rate limits and the daily cap show the API's message (errors.root.server).
    if (!outcome.ok && !isApiError(outcome.error, 'CHALLENGE_REQUIRED')) {
      applyApiErrors(outcome.error, form.setError, ['phoneNumber']);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <FormField
          control={form.control}
          name="phoneNumber"
          label="Mobile number"
          description="Include the country code, for example +94 77 123 4567."
        >
          {(field, control) => <Input type="tel" autoComplete="tel" inputMode="tel" {...field} {...control} />}
        </FormField>
        <FormServerError message={form.formState.errors.root?.server?.message} />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={form.formState.isSubmitting}
          disabled={secondsLeft > 0 || challenging}
        >
          {secondsLeft > 0 ? `Try again in ${formatCountdown(secondsLeft)}` : 'Send code'}
        </Button>
      </FieldGroup>
    </form>
  );
}

const codeSchema = z.object({ code: phoneCodeField });

/** The code was right but no single account could be signed in. */
interface NoAccount {
  kind: 'not-found' | 'ambiguous';
  message: string;
}

function CodeStep({
  sent,
  nextQuery,
  secondsLeft,
  requestCode,
  challenge,
  challenging,
  footer,
  onBack,
}: {
  sent: Sent;
  nextQuery: string;
  secondsLeft: number;
  requestCode: (phoneNumber: string) => Promise<RequestOutcome>;
  challenge: ReactNode;
  challenging: boolean;
  footer: ReactNode;
  onBack: () => void;
}) {
  // Kept after a successful check, so a failed sign-in can be retried without the (used) code.
  const [proof, setProof] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState<NoAccount | null>(null);
  const [codeUsedUp, setCodeUsedUp] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });

  async function verify(code: string): Promise<string | null> {
    try {
      const { data } = await phoneOtpApi.verify({ phoneNumber: sent.phoneNumber, purpose: PURPOSE, code });
      setProof(data.phoneVerificationToken);
      return data.phoneVerificationToken;
    } catch (error) {
      // INVALID_CODE: a wrong guess, the code still works. CODE_EXPIRED: ask for a new one.
      if (isApiError(error, 'INVALID_CODE') || isApiError(error, 'CODE_EXPIRED')) {
        setCodeUsedUp(isApiError(error, 'CODE_EXPIRED'));
        form.setError('code', { type: 'server', message: getErrorMessage(error) }, { shouldFocus: true });
      } else {
        applyApiErrors(error, form.setError, ['code']);
      }
      return null;
    }
  }

  async function onSubmit({ code }: z.output<typeof codeSchema>) {
    const token = proof ?? (await verify(code));
    if (!token) return;
    try {
      const { data, message } = await clientAuthApi.phone({ phoneVerificationToken: token });
      completeClientSignIn(data);
      toast.success(message);
    } catch (error) {
      if (isApiError(error, 'PHONE_ACCOUNT_NOT_FOUND') || isApiError(error, 'PHONE_ACCOUNT_AMBIGUOUS')) {
        setNoAccount({
          kind: isApiError(error, 'PHONE_ACCOUNT_AMBIGUOUS') ? 'ambiguous' : 'not-found',
          message: getErrorMessage(error),
        });
        return;
      }
      // The proof expired or was refused: the next try needs a new code.
      if (isApiError(error, 'PHONE_NOT_VERIFIED')) {
        setProof(null);
        setCodeUsedUp(true);
        form.resetField('code');
      }
      applyApiErrors(error, form.setError, ['code']);
    }
  }

  // On success the flow remounts this step (keyed by sent.id), clearing the code and the proof.
  async function resend() {
    setResending(true);
    setResendError(null);
    const outcome = await requestCode(sent.phoneNumber);
    if (outcome.ok) return;
    setResending(false);
    if (!isApiError(outcome.error, 'CHALLENGE_REQUIRED')) setResendError(getErrorMessage(outcome.error));
  }

  const otherNumber = (
    <button type="button" onClick={onBack} className={linkClass}>
      Use a different number
    </button>
  );

  if (noAccount) {
    return (
      <AuthCard title="No account to sign in" footer={otherNumber}>
        <Alert>
          <AlertTitle>{sent.phoneNumber}</AlertTitle>
          <AlertDescription>{noAccount.message}</AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">
          {noAccount.kind === 'not-found'
            ? 'You may have signed up with your email, or not added this number to your account yet.'
            : 'Your number is linked to more than one account, so we can’t tell which one to open.'}
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild size="lg">
            <Link href={`/login${nextQuery}`}>Sign in with email</Link>
          </Button>
          {noAccount.kind === 'not-found' && (
            <Button asChild variant="outline" size="lg">
              <Link href={`/sign-up${nextQuery}`}>Create an account</Link>
            </Button>
          )}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Enter your code"
      description={
        <>
          We sent a 6-digit code to <span className="font-medium text-foreground">{sent.phoneNumber}</span> by{' '}
          {CHANNEL_LABEL[sent.channel]}.
        </>
      }
      footer={
        <>
          {otherNumber}
          {footer}
        </>
      }
    >
      <DevCodeHint code={sent.devCode} />

      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <FormField control={form.control} name="code" label="Code">
            {(field, control) => (
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                className="font-mono text-lg tracking-[0.4em]"
                {...field}
                {...control}
              />
            )}
          </FormField>
          {codeUsedUp && (
            <p className="text-sm text-muted-foreground">
              A code stops working after a few wrong tries or when it expires. Ask for a new one below.
            </p>
          )}
          <FormServerError message={form.formState.errors.root?.server?.message} />
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Verify and sign in
          </Button>
        </FieldGroup>
      </form>

      <div className="flex flex-col gap-3">
        <Button type="button" variant="outline" onClick={resend} loading={resending} disabled={secondsLeft > 0 || challenging}>
          {secondsLeft > 0 ? `Resend code in ${formatCountdown(secondsLeft)}` : 'Resend code'}
        </Button>
        {resendError && (
          <p role="alert" className="text-sm text-destructive">
            {resendError}
          </p>
        )}
        {challenge}
      </div>
    </AuthCard>
  );
}
