// Building blocks for mock implementations. Mocks must behave like the live API: same shapes,
// a short delay so loading states show, and real errorCode values so error states get built.
// Mock data is fictional: never copy real client names, phone numbers or health details.

import { ApiClientError, type ApiErrorCode } from '../errors';

const DEFAULT_DELAY_MS = 400;

/** Waits like a network round trip. */
export function mockDelay(ms: number = DEFAULT_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves with `data` after the mock delay. */
export async function mockOk<T>(data: T, delayMs?: number): Promise<T> {
  await mockDelay(delayMs);
  // Copy so a component mutating the result can't change the fixture.
  return structuredClone(data);
}

/** Rejects the way the live client would for an error envelope. */
export async function mockFail(
  statusCode: number,
  errorCode: ApiErrorCode,
  message: string,
  errors?: { field: string; messages: string[] }[],
  options: { retryAfterSeconds?: number } = {},
): Promise<never> {
  await mockDelay();
  throw new ApiClientError({ statusCode, errorCode, message, errors, path: 'mock' }, options);
}
