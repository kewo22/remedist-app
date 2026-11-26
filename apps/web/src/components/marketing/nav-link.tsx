'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A menu link that marks itself with aria-current when its page is open. */
export function NavLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
        'aria-[current=page]:text-primary',
        className,
      )}
    >
      {children}
    </Link>
  );
}
