import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
      <Link href="/" className="mb-6 font-display text-2xl font-semibold text-brand-green-deep">
        The Remedist
      </Link>
      <main className="w-full max-w-md">{children}</main>
    </div>
  );
}
