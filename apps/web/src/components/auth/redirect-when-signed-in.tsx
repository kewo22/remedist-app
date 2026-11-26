'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useClientSession } from '@/lib/auth/client-auth';

/**
 * Leaves the auth pages for `next` as soon as a client session exists: right after signing in,
 * or straight away when someone already signed in opens /login. The forms themselves never navigate.
 */
export function RedirectWhenSignedIn({ next }: { next: string }) {
  const state = useClientSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'signed-in') router.replace(next);
  }, [state.status, next, router]);

  return null;
}
