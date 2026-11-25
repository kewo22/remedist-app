import { isServer, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api/errors';

const MAX_RETRIES = 2;

// Retry only what a retry can fix: network failures and 5xx. A 4xx (validation, not found,
// unauthorised, slot taken...) will fail the same way again.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && error.statusCode < 500) return false;
  return failureCount < MAX_RETRIES;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Above zero so data fetched in a server component isn't refetched immediately on the client.
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Never retry writes automatically: a booking or payment must not be sent twice.
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** A fresh client per server request; one shared client in the browser. */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
