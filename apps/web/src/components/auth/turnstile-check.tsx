'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

// Cloudflare Turnstile, shown when the API answers CHALLENGE_REQUIRED. The token it gives is
// single-use: unmount the check once the request it was for has been sent.
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: 'light';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Without a site key the API's demo verifier accepts any token, outside production only. */
const DEV_TOKEN = 'dev-turnstile-token';

/** Calls `onToken` once the person passes the check. */
export function TurnstileCheck({ onToken }: { onToken: (token: string) => void }) {
  if (env.turnstileSiteKey) return <TurnstileWidget siteKey={env.turnstileSiteKey} onToken={onToken} />;

  if (!env.isProduction) {
    return (
      <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => onToken(DEV_TOKEN)}>
        Pass the check (development only)
      </Button>
    );
  }

  return <p className="text-sm text-destructive">The security check isn&apos;t available right now. Please try again later.</p>;
}

function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);

  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const element = container.current;
    const turnstile = window.turnstile;
    if (!ready || !element || !turnstile) return;
    const widgetId = turnstile.render(element, {
      sitekey: siteKey,
      theme: 'light',
      callback: (token) => {
        setProblem(false);
        callback.current(token);
      },
      'expired-callback': () => setProblem(false),
      'error-callback': () => setProblem(true),
    });
    return () => turnstile.remove(widgetId);
  }, [ready, siteKey]);

  return (
    <div className="flex flex-col gap-2">
      <Script src={TURNSTILE_SCRIPT} strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setProblem(true)} />
      <div ref={container} className="min-h-16" />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          The security check couldn&apos;t load. Check your connection and refresh the page.
        </p>
      )}
    </div>
  );
}
