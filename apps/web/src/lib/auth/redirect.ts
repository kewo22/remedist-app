/** Where a client lands after signing in when no `next` is given. */
export const CLIENT_HOME_PATH = '/portal';

/**
 * The `?next=` path to return to after sign-in, only if it stays on this site. Anything else
 * (another origin, `//host`, `/\host`, a missing value) falls back, so the link can't be used to
 * send people to another website.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = CLIENT_HOME_PATH): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

/** `/login?next=/portal/bookings`, keeping only a safe path. */
export function loginPathFor(next: string): string {
  return `/login?next=${encodeURIComponent(safeNextPath(next))}`;
}
