import type { Metadata } from 'next';
import { RedirectWhenSignedIn } from '@/components/auth/redirect-when-signed-in';
import { SignUpFlow } from '@/components/auth/sign-up-flow';
import { readNextParam, type AuthSearchParams } from '../next-param';

export const metadata: Metadata = { title: 'Create an account' };

export default async function SignUpPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const next = await readNextParam(searchParams);
  return (
    <>
      <RedirectWhenSignedIn next={next} />
      <SignUpFlow next={next} />
    </>
  );
}
