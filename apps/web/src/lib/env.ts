// The web app's only reader of process.env. Everything else imports `env` from here.
//
// NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so each one must be
// read with its full literal name (process.env.NEXT_PUBLIC_X): a dynamic lookup would be undefined
// in the browser. Never put a secret in a NEXT_PUBLIC_* variable.

export type ApiMode = 'mock' | 'live';

function readApiMode(value: string | undefined): ApiMode {
  if (value === undefined || value === '') return 'mock';
  if (value === 'mock' || value === 'live') return value;
  throw new Error(`NEXT_PUBLIC_API_MODE must be "mock" or "live" (got "${value}").`);
}

function readUrl(name: string, value: string | undefined, fallback: string): string {
  const raw = value === undefined || value === '' ? fallback : value;
  try {
    // Normalise: no trailing slash, so callers can always join with "/path".
    return new URL(raw).toString().replace(/\/+$/, '');
  } catch {
    throw new Error(`${name} must be an absolute URL (got "${raw}").`);
  }
}

function readOptional(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

const apiUrl = readUrl('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL, 'http://localhost:3001/api/v1');

export const env = {
  /** `mock` serves fixtures from lib/api/mocks; `live` calls the API. Defaults to `mock`. */
  apiMode: readApiMode(process.env.NEXT_PUBLIC_API_MODE),
  /** The versioned API base, e.g. http://localhost:3001/api/v1. */
  apiUrl,
  /** The API's origin, for the few routes outside /api/v1 (such as /health). */
  apiOrigin: new URL(apiUrl).origin,
  turnstileSiteKey: readOptional(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  googleClientId: readOptional(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID),
  whatsappNumber: readOptional(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER),
  sentryDsn: readOptional(process.env.NEXT_PUBLIC_SENTRY_DSN),
  isProduction: process.env.NODE_ENV === 'production',
} as const;
