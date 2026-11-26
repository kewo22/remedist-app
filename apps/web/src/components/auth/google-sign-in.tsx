'use client';

import { useMutation } from '@tanstack/react-query';
import Script from 'next/script';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorAlert } from '@/components/common/error-alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { clientAuthApi } from '@/lib/api/client-auth';
import { completeClientSignIn } from '@/lib/auth/client-auth';
import { env } from '@/lib/env';

// Google Identity Services: Google renders its own button and hands back an ID token
// (`credential`), which the API verifies. https://developers.google.com/identity/gsi/web

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdApi {
  initialize(config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      theme: 'outline';
      size: 'large';
      text: 'continue_with';
      shape: 'rectangular';
      logo_alignment: 'center';
      width: number;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
// Google's button accepts widths from 200 to 400 px.
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
/** Without a Google client id the API accepts `demo:<email>[:<name>]`, outside production only. */
const DEMO_ID_TOKEN = 'demo:alex.silva@example.com:Alex Silva';

/** "Continue with Google". Signs the client in; the page redirects when the session changes. */
export function GoogleSignIn() {
  const signIn = useMutation({
    mutationFn: (idToken: string) => clientAuthApi.google({ idToken }),
    onSuccess: ({ data, message }) => {
      completeClientSignIn(data);
      toast.success(message);
    },
  });

  let button: ReactNode = null;
  if (env.googleClientId) {
    button = <GoogleButton clientId={env.googleClientId} onCredential={signIn.mutate} />;
  } else if (!env.isProduction) {
    button = (
      <Button type="button" variant="outline" size="lg" className="w-full" onClick={() => signIn.mutate(DEMO_ID_TOKEN)}>
        Continue with Google (demo)
      </Button>
    );
  }

  if (!button) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative" aria-busy={signIn.isPending || undefined}>
        {button}
        {signIn.isPending && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/80">
            <Spinner className="size-5" />
            <span className="sr-only">Signing in with Google</span>
          </div>
        )}
      </div>
      {signIn.isError && <ErrorAlert error={signIn.error} title="Couldn't sign in with Google" />}
    </div>
  );
}

function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Google calls back outside React, so it reads the latest handler through a ref.
  const callback = useRef(onCredential);
  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    const element = container.current;
    const gis = window.google?.accounts.id;
    if (!ready || !element || !gis) return;
    gis.initialize({ client_id: clientId, callback: (response) => callback.current(response.credential) });
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(element.offsetWidth)));
    gis.renderButton(element, {
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'center',
      width,
    });
  }, [ready, clientId]);

  if (failed) {
    return <p className="text-sm text-muted-foreground">Google sign-in couldn&apos;t load. Please use your email instead.</p>;
  }

  return (
    <>
      <Script src={GIS_SCRIPT} strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setFailed(true)} />
      {/* Google draws its button here; the min height stops the layout jumping while it loads. */}
      <div ref={container} className="flex min-h-11 w-full justify-center" />
    </>
  );
}
