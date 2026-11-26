import Link from 'next/link';
import { MARKETING_NAV } from './nav-items';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} The Remedist</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {MARKETING_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
