import Link from 'next/link';
import { PagePlaceholder } from '@/components/marketing/page-placeholder';
import { Button } from '@/components/ui/button';

// Content comes with the public site redesign.
export default function HomePage() {
  return (
    <PagePlaceholder
      title="The Remedist"
      description="The new Remedist website is being built. Its pages are in place and their content arrives with the redesign."
    >
      <Button size="lg" className="mt-8" asChild>
        <Link href="/book">Book a session</Link>
      </Button>
    </PagePlaceholder>
  );
}
