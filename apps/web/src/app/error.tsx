'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

// Catches render errors below the root layout. Shows a safe message only, never the error itself.
// Next 16: `error` may be any thrown value, and `retry` re-fetches and re-renders the segment.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // TODO(monitoring): report to Sentry once it's set up.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl">Something went wrong</h1>
      <p className="text-muted-foreground">Sorry, this page didn&apos;t load properly. Please try again.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
