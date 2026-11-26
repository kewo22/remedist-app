// Login tokens live in httpOnly, SameSite cookies set by the API: a short-lived access token
// and a rotating refresh token. The browser never reads them; requests just send cookies
// (`credentials: 'include'`). When the access token expires the API answers 401, the client
// refreshes once and retries. If refreshing fails, the session is over and listeners are told.
//
// Clients and staff have separate sessions (separate JWT secrets), so each has its own refresh route.

export type SessionAudience = 'client' | 'staff';

// TODO(auth): move these into packages/shared/src/contracts/auth.ts once the auth contract is written,
// and confirm the paths with the API side.
export const REFRESH_PATHS: Record<SessionAudience, string> = {
  client: '/public/auth/refresh',
  staff: '/admin/auth/refresh',
};

type SessionExpiredListener = (audience: SessionAudience) => void;

const listeners = new Set<SessionExpiredListener>();

/** Subscribe to "the session has expired and couldn't be refreshed". Returns an unsubscribe function. */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySessionExpired(audience: SessionAudience): void {
  for (const listener of listeners) listener(audience);
}
