import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="text-3xl">We couldn&apos;t find that page</h1>
      <p className="text-muted-foreground">The link may be out of date, or the page may have moved.</p>
      <Button variant="outline" asChild>
        <Link href="/">Back to the home page</Link>
      </Button>
    </main>
  );
}
