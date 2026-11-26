import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { RedirectWhenSignedIn } from '@/components/auth/redirect-when-signed-in';
import { readNextParam, type AuthSearchParams } from '../next-param';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const next = await readNextParam(searchParams);
  return (
    <>
      <RedirectWhenSignedIn next={next} />
      <LoginForm next={next} />
    </>
  );
}
