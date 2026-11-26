import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RequireClientSession } from '@/components/auth/require-client-session';

export const metadata: Metadata = {
  title: 'My account',
  // Private pages: keep them out of search results.
  robots: { index: false, follow: false },
};

// The refresh cookie only goes to /api/v1/portal/auth, so portal pages load their data in the
// browser (client components with TanStack Query), never in server components.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <RequireClientSession>{children}</RequireClientSession>;
}
