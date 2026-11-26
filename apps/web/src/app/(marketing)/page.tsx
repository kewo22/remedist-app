import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Placeholder until the marketing pages are ported (home, about, ailments...).
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6 py-16 sm:px-8">
      <p className="eyebrow">The Remedist</p>
      <h1 className="text-4xl sm:text-5xl">
        Care that starts with <em className="font-medium text-brand-green-deep">listening</em>.
      </h1>
      <p className="max-w-xl text-muted-foreground">
        The new Remedist web app is being built. Booking, the client portal and the CRM arrive here one area at a time.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" asChild>
          <Link href="/book">Book a session</Link>
        </Button>
      </div>
    </main>
  );
}
