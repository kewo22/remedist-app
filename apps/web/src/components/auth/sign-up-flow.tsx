'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CLIENT_PASSWORD_MIN_LENGTH, normalizeEmail, type ClientRegisterRequest } from '@remedist/shared';
import Link from 'next/link';
import { useState } from 'react';
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
import { emailField, nameField, newPasswordField, oneTimeCodeField } from '@/lib/auth/schemas';
import { applyApiErrors } from '@/lib/forms';
import { formatCountdown, useCountdown } from '@/lib/hooks/use-countdown';
import { AuthCard, AuthDivider, FormServerError } from './auth-card';
import { DevCodeHint } from './dev-code-hint';
import { GoogleSignIn } from './google-sign-in';
import { PasswordInput } from './password-input';

interface Sent {
  details: ClientRegisterRequest;
  /** The normalised email the API sent the code to. */
  email: string;
  message: string;
  devCode: string | undefined;
}

/** Sign-up: details, then the 6-digit code from the email. Verifying signs the client in. */
export function SignUpFlow({ next }: { next: string }) {
  const [sent, setSent] = useState<Sent | null>(null);
  const loginHref = `/login?next=${encodeURIComponent(next)}`;

  if (sent) return <VerifyEmailStep sent={sent} onResent={setSent} onBack={() => setSent(null)} />;

  return (
    <AuthCard
      title="Create your account"
      description="Book sessions, pay and see your appointments in one place."
      footer={
        <p>
          Already have an account?{' '}
          <Link href={loginHref} className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <GoogleSignIn />
      <AuthDivider />
      <DetailsForm onSent={setSent} />
    </AuthCard>
  );
}

const detailsSchema = z.object({ name: nameField, email: emailField, password: newPasswordField });
type DetailsInput = z.input<typeof detailsSchema>;
const DETAILS_FIELDS = ['name', 'email', 'password'] as const satisfies readonly (keyof DetailsInput)[];

function DetailsForm({ onSent }: { onSent: (sent: Sent) => void }) {
  const wait = useCountdown();
  const form = useForm({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: '', email: '', password: '' } satisfies DetailsInput,
  });

  async function onSubmit(values: z.output<typeof detailsSchema>) {
    const details: ClientRegisterRequest = { ...values, email: normalizeEmail(values.email) };
    try {
      const { data, message } = await clientAuthApi.register(details);
      onSent({ details, email: data.email, message, devCode: data.devCode });
    } catch (error) {
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter) wait.start(retryAfter);
      applyApiErrors(error, form.setError, DETAILS_FIELDS);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <FormField control={form.control} name="name" label="Full name">
          {(field, control) => <Input autoComplete="name" {...field} {...control} />}
        </FormField>
        <FormField control={form.control} name="email" label="Email">
          {(field, control) => <Input type="email" autoComplete="email" inputMode="email" {...field} {...control} />}
        </FormField>
        <FormField control={form.control} name="password" label="Password" description={`At least ${CLIENT_PASSWORD_MIN_LENGTH} characters.`}>
          {(field, control) => <PasswordInput autoComplete="new-password" {...field} {...control} />}
        </FormField>
        <FormServerError message={form.formState.errors.root?.server?.message} />
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting} disabled={wait.secondsLeft > 0}>
          {wait.secondsLeft > 0 ? `Try again in ${formatCountdown(wait.secondsLeft)}` : 'Create account'}
        </Button>
      </FieldGroup>
    </form>
  );
}

const codeSchema = z.object({ code: oneTimeCodeField });

function VerifyEmailStep({ sent, onResent, onBack }: { sent: Sent; onResent: (sent: Sent) => void; onBack: () => void }) {
  // Separate waits: a refused resend must not stop the client entering the code they already have.
  const verifyWait = useCountdown();
  const resendWait = useCountdown();
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [codeRejected, setCodeRejected] = useState(false);
  const form = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });

  async function onSubmit({ code }: z.output<typeof codeSchema>) {
    try {
      const { data, message } = await clientAuthApi.verifyEmail({ email: sent.email, code });
      completeClientSignIn(data);
      toast.success(message);
    } catch (error) {
      if (isApiError(error, 'INVALID_CODE')) {
        setCodeRejected(true);
        form.setError('code', { type: 'server', message: getErrorMessage(error) }, { shouldFocus: true });
        return;
      }
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter) verifyWait.start(retryAfter);
      applyApiErrors(error, form.setError, ['code']);
    }
  }

  // Sending the same details again sends a new code (the API's documented way to resend).
  async function resend() {
    setResending(true);
    setResendError(null);
    try {
      const { data, message } = await clientAuthApi.register(sent.details);
      onResent({ ...sent, email: data.email, message, devCode: data.devCode });
      setCodeRejected(false);
      form.reset({ code: '' });
      toast.success('We sent a new code.');
    } catch (error) {
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter) resendWait.start(retryAfter);
      setResendError(getErrorMessage(error));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthCard
      title="Check your email"
      description={
        <>
          We sent a 6-digit code to <span className="font-medium text-foreground">{sent.email}</span>.
        </>
      }
      footer={
        <button type="button" onClick={onBack} className="font-medium text-primary underline-offset-4 hover:underline">
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
          <FormField control={form.control} name="code" label="Verification code">
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
          <FormServerError message={form.formState.errors.root?.server?.message} />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={form.formState.isSubmitting}
            disabled={verifyWait.secondsLeft > 0}
          >
            {verifyWait.secondsLeft > 0 ? `Try again in ${formatCountdown(verifyWait.secondsLeft)}` : 'Verify and continue'}
          </Button>
        </FieldGroup>
      </form>

      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" onClick={resend} loading={resending} disabled={resendWait.secondsLeft > 0}>
          {resendWait.secondsLeft > 0 ? `Send a new code in ${formatCountdown(resendWait.secondsLeft)}` : 'Send a new code'}
        </Button>
        {resendError && (
          <p role="alert" className="text-sm text-destructive">
            {resendError}
          </p>
        )}
      </div>
    </AuthCard>
  );
}
