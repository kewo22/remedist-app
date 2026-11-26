import type { Metadata } from 'next';
import { ForgotPasswordFlow } from '@/components/auth/forgot-password-flow';
import { RedirectWhenSignedIn } from '@/components/auth/redirect-when-signed-in';
import { readNextParam, type AuthSearchParams } from '../next-param';

export const metadata: Metadata = { title: 'Reset your password' };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const next = await readNextParam(searchParams);
  return (
    <>
      <RedirectWhenSignedIn next={next} />
      <ForgotPasswordFlow next={next} />
    </>
  );
}
