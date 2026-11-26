'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CLIENT_PASSWORD_MIN_LENGTH, normalizeEmail } from '@remedist/shared';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField } from '@/components/common/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { clientAuthApi } from '@/lib/api/client-auth';
import { getErrorMessage, getRetryAfterSeconds, isApiError } from '@/lib/api/errors';
import { completeClientSignIn } from '@/lib/auth/client-auth';
import { emailField, newPasswordField, oneTimeCodeField } from '@/lib/auth/schemas';
import { applyApiErrors } from '@/lib/forms';
import { formatCountdown, useCountdown } from '@/lib/hooks/use-countdown';
import { AuthCard, FormServerError } from './auth-card';
import { DevCodeHint } from './dev-code-hint';
import { PasswordInput } from './password-input';
import { TurnstileCheck } from './turnstile-check';

// Reset codes go by email only: the API refuses `phone` with CHANNEL_UNAVAILABLE for now.
const CHANNEL = 'email';
const linkClass = 'font-medium text-primary underline-offset-4 hover:underline';

interface Sent {
  /** Changes with every code sent, so the reset step starts fresh for a new code. */
  id: number;
  email: string;
  message: string;
  devCode: string | undefined;
}

type RequestOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * Forgot password: ask for the email, send a reset code, then set a new password with the code.
 * Resetting signs the client in (and signs out every other device).
 */
export function ForgotPasswordFlow({ next }: { next: string }) {
  const [sent, setSent] = useState<Sent | null>(null);
  // CHALLENGE_REQUIRED: show the security check, then repeat the request for this email with its token.
  const [challengeFor, setChallengeFor] = useState<string | null>(null);
  // An error from the request repeated after the check (the forms only see their own submits).
  const [retryError, setRetryError] = useState<string | null>(null);
  const wait = useCountdown();

  async function requestCode(email: string, turnstileToken?: string): Promise<RequestOutcome> {
    setRetryError(null);
    try {
      const { data, message } = await clientAuthApi.forgotPassword({ email, channel: CHANNEL, turnstileToken });
      setChallengeFor(null);
      // A resend (straight away or after the security check) replaces the reset step.
      if (sent) toast.success('We sent a new code.');
      setSent({ id: (sent?.id ?? 0) + 1, email, message, devCode: data.devCode });
      wait.start(data.nextResendWaitSeconds);
      return { ok: true };
    } catch (error) {
      if (isApiError(error, 'CHALLENGE_REQUIRED')) {
        setChallengeFor(email);
      } else {
        setChallengeFor(null);
        const retryAfter = getRetryAfterSeconds(error);
        if (retryAfter) wait.start(retryAfter);
      }
      return { ok: false, error };
    }
  }

  async function retryWithToken(email: string, token: string) {
    const outcome = await requestCode(email, token);
    if (!outcome.ok && !isApiError(outcome.error, 'CHALLENGE_REQUIRED')) setRetryError(getErrorMessage(outcome.error));
  }

  let challenge: ReactNode = null;
  if (challengeFor) {
    challenge = (
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <p className="text-sm">Please complete this quick security check, and we&apos;ll send the code.</p>
        {/* Keyed by email so a fresh widget (and a fresh single-use token) is used each time. */}
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

  const loginLink = (
    <p>
      Remembered it?{' '}
      <Link href={`/login?next=${encodeURIComponent(next)}`} className={linkClass}>
        Back to sign in
      </Link>
    </p>
  );

  if (sent) {
    return (
      <ResetStep
        key={sent.id}
        sent={sent}
        secondsLeft={wait.secondsLeft}
        requestCode={requestCode}
        challenge={challenge}
        challenging={challengeFor !== null}
        onBack={() => {
          setSent(null);
          setChallengeFor(null);
          setRetryError(null);
          // The resend wait is per email: another address may be sent straight away.
          wait.reset();
        }}
      />
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a 6-digit code."
      footer={loginLink}
    >
      <EmailStep secondsLeft={wait.secondsLeft} requestCode={requestCode} challenging={challengeFor !== null} />
      {challenge}
      <p className="text-sm text-muted-foreground">
        Signed up with Google? Your account has no password to reset: use Continue with Google on the sign-in page.
      </p>
    </AuthCard>
  );
}

const emailSchema = z.object({ email: emailField });

function EmailStep({
  secondsLeft,
  requestCode,
  challenging,
}: {
  secondsLeft: number;
  requestCode: (email: string) => Promise<RequestOutcome>;
  challenging: boolean;
}) {
  const form = useForm({ resolver: zodResolver(emailSchema), defaultValues: { email: '' } });

  async function onSubmit({ email }: z.output<typeof emailSchema>) {
    const outcome = await requestCode(normalizeEmail(email));
    if (!outcome.ok && !isApiError(outcome.error, 'CHALLENGE_REQUIRED')) {
      applyApiErrors(outcome.error, form.setError, ['email']);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <FormField control={form.control} name="email" label="Email">
          {(field, control) => <Input type="email" autoComplete="email" inputMode="email" {...field} {...control} />}
        </FormField>
        <FormServerError message={form.formState.errors.root?.server?.message} />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={form.formState.isSubmitting}
          disabled={secondsLeft > 0 || challenging}
        >
          {secondsLeft > 0 ? `Try again in ${formatCountdown(secondsLeft)}` : 'Send reset code'}
        </Button>
      </FieldGroup>
    </form>
  );
}

const resetSchema = z.object({ code: oneTimeCodeField, newPassword: newPasswordField });
type ResetInput = z.input<typeof resetSchema>;
const RESET_FIELDS = ['code', 'newPassword'] as const satisfies readonly (keyof ResetInput)[];

function ResetStep({
  sent,
  secondsLeft,
  requestCode,
  challenge,
  challenging,
  onBack,
}: {
  sent: Sent;
  challenging: boolean;
  secondsLeft: number;
  requestCode: (email: string) => Promise<RequestOutcome>;
  challenge: ReactNode;
  onBack: () => void;
}) {
  const wait = useCountdown();
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [codeRejected, setCodeRejected] = useState(false);
  const form = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', newPassword: '' } satisfies ResetInput,
  });

  async function onSubmit({ code, newPassword }: z.output<typeof resetSchema>) {
    try {
      const { data, message } = await clientAuthApi.resetPassword({ email: sent.email, channel: CHANNEL, code, newPassword });
      completeClientSignIn(data);
      toast.success(message);
    } catch (error) {
      if (isApiError(error, 'INVALID_CODE')) {
        setCodeRejected(true);
        form.setError('code', { type: 'server', message: getErrorMessage(error) }, { shouldFocus: true });
        return;
      }
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter) wait.start(retryAfter);
      applyApiErrors(error, form.setError, RESET_FIELDS);
    }
  }

  // On success the flow remounts this step (keyed by sent.id), clearing the code.
  async function resend() {
    setResending(true);
    setResendError(null);
    const outcome = await requestCode(sent.email);
    if (outcome.ok) return;
    setResending(false);
    if (!isApiError(outcome.error, 'CHALLENGE_REQUIRED')) setResendError(getErrorMessage(outcome.error));
  }

  return (
    <AuthCard
      title="Enter your reset code"
      description={
        <>
          If <span className="font-medium text-foreground">{sent.email}</span> has an account, a 6-digit code is on its way.
        </>
      }
      footer={
        <button type="button" onClick={onBack} className={linkClass}>
          Use a different email
        </button>
      }
    >
      <Alert>
        <AlertDescription>{sent.message}</AlertDescription>
      </Alert>
      <DevCodeHint code={sent.devCode} />

      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <FormField control={form.control} name="code" label="Reset code">
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
          {codeRejected && (
            <p className="text-sm text-muted-foreground">
              A code stops working after a few wrong tries or when it expires. You can ask for a new one below.
            </p>
          )}
          <FormField
            control={form.control}
            name="newPassword"
            label="New password"
            description={`At least ${CLIENT_PASSWORD_MIN_LENGTH} characters. You'll be signed out on your other devices.`}
          >
            {(field, control) => <PasswordInput autoComplete="new-password" {...field} {...control} />}
          </FormField>
          <FormServerError message={form.formState.errors.root?.server?.message} />
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting} disabled={wait.secondsLeft > 0}>
            {wait.secondsLeft > 0 ? `Try again in ${formatCountdown(wait.secondsLeft)}` : 'Reset password and sign in'}
          </Button>
        </FieldGroup>
      </form>

      <div className="flex flex-col gap-3">
        <Button type="button" variant="outline" onClick={resend} loading={resending} disabled={secondsLeft > 0 || challenging}>
          {secondsLeft > 0 ? `Send a new code in ${formatCountdown(secondsLeft)}` : 'Send a new code'}
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
