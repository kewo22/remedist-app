import type { Metadata } from 'next';
import { PhoneLoginFlow } from '@/components/auth/phone-login-flow';
import { RedirectWhenSignedIn } from '@/components/auth/redirect-when-signed-in';
import { readNextParam, type AuthSearchParams } from '../../next-param';

export const metadata: Metadata = { title: 'Sign in with your phone' };

export default async function PhoneLoginPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const next = await readNextParam(searchParams);
  return (
    <>
      <RedirectWhenSignedIn next={next} />
      <PhoneLoginFlow next={next} />
    </>
  );
}
