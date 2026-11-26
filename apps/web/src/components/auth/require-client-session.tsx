'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useClientSession } from '@/lib/auth/client-auth';
import { loginPathFor } from '@/lib/auth/redirect';

/**
 * Shows its children only to a signed-in client. While the session is being restored it shows
 * a spinner; once it's signed out (never signed in, or the session ended) it sends the visitor
 * to login and back here afterwards. The API still checks every portal call.
 */
export function RequireClientSession({ children }: { children: ReactNode }) {
  const state = useClientSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'signed-out') router.replace(loginPathFor(pathname));
  }, [state.status, pathname, router]);

  if (state.status !== 'signed-in') {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <Spinner className="size-6 text-primary" />
        <span className="sr-only">Loading your account</span>
      </div>
    );
  }

  return children;
}
