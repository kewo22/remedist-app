import type { ReactNode } from 'react';

/**
 * The heading for a public page whose content isn't built yet. The pages are routed now and
 * filled from the API once the redesign is ready.
 */
export function PagePlaceholder({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-4xl sm:text-5xl">{title}</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}
