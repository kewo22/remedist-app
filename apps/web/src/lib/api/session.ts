// The signed-in session for each audience (clients and staff), held in memory only.
//
// - The access token lives here and nowhere else: never in localStorage or a readable cookie.
//   The API client sends it as `Authorization: Bearer` on calls made with `auth: 'client' | 'staff'`.
// - The refresh token is an httpOnly cookie the API sets, scoped to that audience's auth routes.
//   The browser sends it by itself; this file never sees it.
// - On a full page load the session starts as `restoring` until the first refresh answers.
// - A refresh is scheduled shortly before the access token expires. Only one refresh runs at a
//   time per audience, and a 409 REFRESH_CONFLICT (another tab refreshed first) is retried once.
//
// The refresh call itself is registered by the audience's auth module (registerRefresher), so
// the same code path works with the live API and with the mocks.

import type { ClientSession, StaffSession } from '@remedist/shared';
import { isApiError } from './errors';

export type SessionAudience = 'client' | 'staff';

export interface SessionByAudience {
  client: ClientSession;
  staff: StaffSession;
}

export type SessionState<A extends SessionAudience> =
  | { status: 'restoring' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: SessionByAudience[A] };

/** Refresh this long before the access token expires. */
const REFRESH_LEAD_MS = 60_000;
/** Never schedule sooner than this, so a clock skew can't cause a refresh loop. */
const MIN_REFRESH_DELAY_MS = 5_000;

type Refresher<A extends SessionAudience> = () => Promise<SessionByAudience[A]>;

interface Store<A extends SessionAudience> {
  state: SessionState<A>;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | undefined;
  refresher: Refresher<A> | undefined;
  pending: Promise<boolean> | undefined;
}

function createStore<A extends SessionAudience>(): Store<A> {
  return { state: RESTORING, listeners: new Set(), timer: undefined, refresher: undefined, pending: undefined };
}

const RESTORING = { status: 'restoring' } as const;
const SIGNED_OUT = { status: 'signed-out' } as const;

const stores: { [A in SessionAudience]: Store<A> } = {
  client: createStore<'client'>(),
  staff: createStore<'staff'>(),
};

export function getSessionState<A extends SessionAudience>(audience: A): SessionState<A> {
  return stores[audience].state;
}

/** For useSyncExternalStore. Returns an unsubscribe function. */
export function subscribeSession(audience: SessionAudience, listener: () => void): () => void {
  const { listeners } = stores[audience];
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccessToken(audience: SessionAudience): string | undefined {
  const { state } = stores[audience];
  return state.status === 'signed-in' ? state.session.accessToken : undefined;
}

/** Store a session the API just issued (sign-in, verify, reset or refresh) and schedule its refresh. */
export function setSession<A extends SessionAudience>(audience: A, session: SessionByAudience[A]): void {
  const store = stores[audience];
  update(store, { status: 'signed-in', session });
  schedule(store, audience, session.accessTokenExpiresAt);
}

/** Forget the session (signed out, or it couldn't be refreshed). */
export function endSession(audience: SessionAudience): void {
  const store = stores[audience];
  clearTimeout(store.timer);
  store.timer = undefined;
  update(store, SIGNED_OUT);
}

export function registerRefresher<A extends SessionAudience>(audience: A, refresher: Refresher<A>): void {
  stores[audience].refresher = refresher;
}

/**
 * Get a new access token with the refresh cookie. Resolves true when a session is now stored.
 * Concurrent callers share one request.
 *
 * - The API refused (no cookie, expired, revoked): the session ends.
 * - The API couldn't be reached: a restoring session counts as signed out; a signed-in one is
 *   kept, and the next request's 401 tries again.
 */
export function refreshSession(audience: SessionAudience): Promise<boolean> {
  const store = stores[audience];
  store.pending ??= runRefresh(audience).finally(() => {
    store.pending = undefined;
  });
  return store.pending;
}

async function runRefresh<A extends SessionAudience>(audience: A): Promise<boolean> {
  const store: Store<A> = stores[audience];
  const refresher = store.refresher;
  if (!refresher) {
    endSession(audience);
    return false;
  }

  try {
    setSession(audience, await refreshOnceMore(refresher));
    return true;
  } catch (error) {
    if (isApiError(error) && error.statusCode < 500) {
      endSession(audience);
    } else if (store.state.status === 'restoring') {
      update(store, SIGNED_OUT);
    }
    return false;
  }
}

// Another tab may have just rotated the cookie: the browser already has the new one, so one retry works.
async function refreshOnceMore<T>(refresher: () => Promise<T>): Promise<T> {
  try {
    return await refresher();
  } catch (error) {
    if (isApiError(error, 'REFRESH_CONFLICT')) return refresher();
    throw error;
  }
}

function update<A extends SessionAudience>(store: Store<A>, state: SessionState<A>): void {
  store.state = state;
  for (const listener of store.listeners) listener();
}

function schedule<A extends SessionAudience>(store: Store<A>, audience: A, expiresAt: string): void {
  clearTimeout(store.timer);
  store.timer = undefined;
  if (typeof window === 'undefined') return;

  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return;
  const delay = Math.max(expiry - Date.now() - REFRESH_LEAD_MS, MIN_REFRESH_DELAY_MS);
  store.timer = setTimeout(() => void refreshSession(audience), delay);
}
