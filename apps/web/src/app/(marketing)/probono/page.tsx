import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/marketing/page-placeholder';

export const metadata: Metadata = { title: 'Pro-bono' };

// Content comes with the public site redesign: how the pro-bono programme works, and the
// application for logged-in clients.
export default function ProbonoPage() {
  return <PagePlaceholder title="Pro-bono sessions" description="How the pro-bono programme works and how to apply." />;
}
