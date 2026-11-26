import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { env } from '@/lib/env';
import { UiKit } from './ui-kit';

export const metadata: Metadata = { title: 'UI kit', robots: { index: false } };

// Developer reference: every shared component in the brand styles, plus the API connection status.
// Not served in production.
export default function UiKitPage() {
  if (env.isProduction) notFound();
  return <UiKit />;
}
