import { env } from '@/lib/env';

/**
 * Picks a domain's live or mock implementation from NEXT_PUBLIC_API_MODE.
 * Both must satisfy the same interface (built from the shared contract), so screens don't care which runs.
 *
 *   export const bookingsApi = selectApi<BookingsApi>({ live: liveBookings, mock: mockBookings });
 */
export function selectApi<T>(implementations: { live: T; mock: T }): T {
  return env.apiMode === 'live' ? implementations.live : implementations.mock;
}
