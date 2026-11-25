// The single place the web app talks HTTP to the API. Domain files in lib/api/ build on it;
// components never call fetch directly.
//
// - Unwraps the { success, data } envelope and returns `data` (or the whole envelope for `meta`).
// - Turns error envelopes into ApiClientError and transport failures into NetworkError.
// - Sends the auth cookies, and on a 401 refreshes the session once and retries (browser only).

import type { ApiError, ApiSuccess } from '@remedist/shared';
import { env } from '@/lib/env';
import { ApiClientError, NetworkError } from './errors';
import { notifySessionExpired, REFRESH_PATHS, type SessionAudience } from './session';

const DEFAULT_TIMEOUT_MS = 15_000;

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Serialised as JSON, or sent as-is when it's FormData. */
  body?: unknown;
  /** Undefined and null values are dropped. */
  query?: Record<string, QueryValue | QueryValue[]>;
  /** Which session this call belongs to. Enables refresh-and-retry on 401. */
  auth?: SessionAudience;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** `versioned` (default) joins onto /api/v1; `origin` onto the API's origin, for /health. */
  base?: 'versioned' | 'origin';
  /** Passed to Next's fetch, for server components (for example `{ revalidate: 60, tags: [...] }`). */
  next?: NextFetchRequestConfig;
  cache?: RequestCache;
}

/** Calls the API and returns the full success envelope (use when you need `meta`). */
export async function apiRequestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
  const response = await send(path, options);

  if (response.status === 401 && options.auth && isBrowser()) {
    const refreshed = await refreshSession(options.auth);
    if (refreshed) {
      const retry = await send(path, options);
      if (retry.status === 401) notifySessionExpired(options.auth);
      return readEnvelope<T>(retry);
    }
    notifySessionExpired(options.auth);
  }

  return readEnvelope<T>(response);
}

/** Calls the API and returns `data` from the success envelope. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await apiRequestEnvelope<T>(path, options);
  return envelope.data;
}

type BodylessOptions = Omit<RequestOptions, 'method' | 'body'>;

export const api = {
  get: <T>(path: string, options?: BodylessOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: BodylessOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: BodylessOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: BodylessOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: BodylessOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

export function buildUrl(path: string, options: Pick<RequestOptions, 'query' | 'base'> = {}): string {
  const base = options.base === 'origin' ? env.apiOrigin : env.apiUrl;
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v !== undefined && v !== null) url.searchParams.append(key, String(v));
    }
  }
  return url.toString();
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body; // the browser sets the multipart boundary
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  try {
    return await fetch(buildUrl(path, options), {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal,
      cache: options.cache,
      next: options.next,
    });
  } catch (error) {
    // A caller's own abort (e.g. TanStack Query cancelling) is not a network failure: rethrow it.
    if (options.signal?.aborted) throw error;
    throw new NetworkError(timeout.aborted, { cause: error });
  }
}

async function readEnvelope<T>(response: Response): Promise<ApiSuccess<T>> {
  const payload = await readJson(response);

  if (isEnvelope(payload)) {
    if (payload.success) return payload as ApiSuccess<T>;
    throw new ApiClientError(payload as ApiError);
  }

  // No envelope: a proxy error page, an empty 204, or a route that skips the envelope.
  if (!response.ok) {
    throw new ApiClientError({
      statusCode: response.status,
      errorCode: response.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
      message: 'Something went wrong. Please try again.',
    });
  }
  return { success: true, statusCode: response.status, message: '', data: payload as T };
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function isEnvelope(value: unknown): value is { success: boolean } {
  return typeof value === 'object' && value !== null && typeof (value as { success?: unknown }).success === 'boolean';
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

// One refresh at a time per audience: if five queries hit 401 together, they share one refresh call.
const pendingRefresh = new Map<SessionAudience, Promise<boolean>>();

function refreshSession(audience: SessionAudience): Promise<boolean> {
  const existing = pendingRefresh.get(audience);
  if (existing) return existing;

  const attempt = send(REFRESH_PATHS[audience], { method: 'POST' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => pendingRefresh.delete(audience));

  pendingRefresh.set(audience, attempt);
  return attempt;
}
