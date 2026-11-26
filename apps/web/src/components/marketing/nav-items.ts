// The public site's pages, in menu order. The header and footer both read this list.

export interface MarketingNavItem {
  href: string;
  label: string;
}

export const MARKETING_NAV: readonly MarketingNavItem[] = [
  { href: '/about', label: 'About' },
  { href: '/ailments', label: 'Ailments' },
  { href: '/testimonials', label: 'Testimonials' },
  { href: '/faq', label: 'FAQ' },
  { href: '/probono', label: 'Pro-bono' },
];
