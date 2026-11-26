import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/marketing/page-placeholder';

export const metadata: Metadata = { title: 'Testimonials' };

// Content comes with the public site redesign: approved testimonials from the API, and the form to submit one.
export default function TestimonialsPage() {
  return <PagePlaceholder title="Testimonials" description="What our clients say." />;
}
