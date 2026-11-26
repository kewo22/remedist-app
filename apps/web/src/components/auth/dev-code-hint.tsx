import { env } from '@/lib/env';

/**
 * Shows the `devCode` the API returns when it runs without an email key (never in production),
 * so the flow can be tested locally. The flow never depends on it.
 */
export function DevCodeHint({ code }: { code: string | undefined }) {
  if (!code || env.isProduction) return null;
  return (
    <p className="rounded-md border border-dashed border-brand-gold px-3 py-2 text-sm text-muted-foreground">
      Development only: the code is <span className="font-mono font-medium text-foreground">{code}</span>
    </p>
  );
}
