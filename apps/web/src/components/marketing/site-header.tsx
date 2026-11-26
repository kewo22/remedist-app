import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { NavLink } from './nav-link';
import { MARKETING_NAV } from './nav-items';

// A plain header for routing only; the public site's design is being redone.
export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-xl font-semibold text-brand-green-deep">
          The Remedist
        </Link>
        <Button size="sm" className="ml-auto sm:order-last" asChild>
          <Link href="/book">Book</Link>
        </Button>
        {/* Scrolls sideways on narrow screens instead of wrapping into a second menu. */}
        <nav aria-label="Main" className="-mx-2 w-full overflow-x-auto sm:w-auto">
          <ul className="flex gap-1">
            {MARKETING_NAV.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
