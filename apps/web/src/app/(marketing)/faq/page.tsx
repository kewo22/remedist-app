import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/marketing/page-placeholder';

export const metadata: Metadata = { title: 'FAQ' };

// Content comes with the public site redesign: the published FAQs, from the API.
export default function FaqPage() {
  return <PagePlaceholder title="Frequently asked questions" description="Answers to common questions about sessions, booking and payment." />;
}
