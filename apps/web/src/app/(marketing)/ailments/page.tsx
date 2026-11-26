import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/marketing/page-placeholder';

export const metadata: Metadata = { title: 'Ailments' };

// Content comes with the public site redesign: the list of ailments, from the API.
export default function AilmentsPage() {
  return <PagePlaceholder title="Ailments" description="The conditions we help with." />;
}
