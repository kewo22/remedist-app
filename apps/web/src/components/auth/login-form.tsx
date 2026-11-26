'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { normalizeEmail } from '@remedist/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { clientAuthApi } from '@/lib/api/client-auth';
import { getRetryAfterSeconds, isApiError } from '@/lib/api/errors';
import { completeClientSignIn } from '@/lib/auth/client-auth';
import { currentPasswordField, emailField } from '@/lib/auth/schemas';
import { applyApiErrors } from '@/lib/forms';
import { formatCountdown, useCountdown } from '@/lib/hooks/use-countdown';
import { AuthCard, AuthDivider, FormServerError } from './auth-card';
import { GoogleSignIn } from './google-sign-in';
import { PasswordInput } from './password-input';

const schema = z.object({ email: emailField, password: currentPasswordField });
type LoginInput = z.input<typeof schema>;
const FIELDS = ['email', 'password'] as const satisfies readonly (keyof LoginInput)[];

const linkClass = 'font-medium text-primary underline-offset-4 hover:underline';

export function LoginForm({ next }: { next: string }) {
  const wait = useCountdown();
  // A Google-only or unverified account gets the same INVALID_CREDENTIALS as a wrong password.
  const [credentialsRejected, setCredentialsRejected] = useState(false);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' } satisfies LoginInput,
  });
  const nextQuery = `?next=${encodeURIComponent(next)}`;

  async function onSubmit({ email, password }: z.output<typeof schema>) {
    setCredentialsRejected(false);
    try {
      const { data, message } = await clientAuthApi.login({ email: normalizeEmail(email), password });
      completeClientSignIn(data);
      toast.success(message);
    } catch (error) {
      setCredentialsRejected(isApiError(error, 'INVALID_CREDENTIALS'));
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter) wait.start(retryAfter);
      applyApiErrors(error, form.setError, FIELDS);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back to The Remedist."
      footer={
        <p>
          New here?{' '}
          <Link href={`/sign-up${nextQuery}`} className={linkClass}>
            Create an account
          </Link>
        </p>
      }
    >
      <GoogleSignIn />
      <AuthDivider />
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <FormField control={form.control} name="email" label="Email">
            {(field, control) => <Input type="email" autoComplete="email" inputMode="email" {...field} {...control} />}
          </FormField>
          <FormField control={form.control} name="password" label="Password">
            {(field, control) => <PasswordInput autoComplete="current-password" {...field} {...control} />}
          </FormField>
          <div className="-mt-3 text-sm">
            <Link href={`/forgot-password${nextQuery}`} className={linkClass}>
              Forgot your password?
            </Link>
          </div>
          <FormServerError message={form.formState.errors.root?.server?.message} />
          {credentialsRejected && (
            <p className="text-sm text-muted-foreground">
              Signed up with Google? Use <span className="font-medium text-foreground">Continue with Google</span> above. If you
              haven&apos;t verified your email yet, finish signing up first.
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting} disabled={wait.secondsLeft > 0}>
            {wait.secondsLeft > 0 ? `Try again in ${formatCountdown(wait.secondsLeft)}` : 'Sign in'}
          </Button>
        </FieldGroup>
      </form>
      <Button asChild variant="outline" size="lg" className="w-full">
        <Link href={`/login/phone${nextQuery}`}>Sign in with a phone code</Link>
      </Button>
    </AuthCard>
  );
}
