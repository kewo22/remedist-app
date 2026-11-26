'use client';

// The client (patient) session for components: read it with useClientSession(), store a new one
// with completeClientSignIn(), and end it with signOutClient() / signOutClientEverywhere().
// <ClientSessionRestorer> (mounted once in the root providers) restores the session on page load.

import type { ClientSession } from '@remedist/shared';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { clientAuthApi } from '@/lib/api/client-auth';
import {
  endSession,
  getSessionState,
  refreshSession,
  registerRefresher,
  setSession,
  subscribeSession,
  type SessionState,
} from '@/lib/api/session';
import { getQueryClient } from '@/lib/query-client';

registerRefresher('client', () => clientAuthApi.refresh());

const subscribe = (listener: () => void) => subscribeSession('client', listener);
const getSnapshot = () => getSessionState('client');
const SERVER_SNAPSHOT: SessionState<'client'> = { status: 'restoring' };
const getServerSnapshot = () => SERVER_SNAPSHOT;

export type ClientSessionState = SessionState<'client'>;

export function useClientSession(): ClientSessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Call with the ClientSession from login, verify-email, Google or reset-password. */
export function completeClientSignIn(session: ClientSession): void {
  setSession('client', session);
}

/** Ends this device's session. The local session ends even if the API can't be reached. */
export async function signOutClient(): Promise<void> {
  try {
    await clientAuthApi.logout();
  } finally {
    endSession('client');
  }
}

/** Ends every session for this account. Throws if the API refuses, so the caller can show why. */
export async function signOutClientEverywhere(): Promise<void> {
  await clientAuthApi.logoutAll();
  endSession('client');
}

/**
 * Restores the session from the refresh cookie once per page load, and clears cached data
 * whenever a session ends (sign-out or expiry), so nothing fetched for one client is shown to
 * whoever signs in next on this device. Renders nothing.
 */
export function ClientSessionRestorer() {
  const started = useRef(false);
  const state = useClientSession();
  const previous = useRef(state.status);

  useEffect(() => {
    if (started.current || getSessionState('client').status !== 'restoring') return;
    started.current = true;
    void refreshSession('client');
  }, []);

  useEffect(() => {
    if (previous.current === 'signed-in' && state.status === 'signed-out') getQueryClient().removeQueries();
    previous.current = state.status;
  }, [state.status]);

  return null;
}
