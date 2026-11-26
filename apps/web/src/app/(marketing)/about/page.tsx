import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/marketing/page-placeholder';

export const metadata: Metadata = { title: 'About' };

// Content comes with the public site redesign.
export default function AboutPage() {
  return <PagePlaceholder title="About" description="Who we are and how we work." />;
}
