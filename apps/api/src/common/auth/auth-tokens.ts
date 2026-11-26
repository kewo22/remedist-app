import { createHash, randomBytes, randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { FAIL_DELAY_MAX_MS, FAIL_DELAY_MIN_MS, REFRESH_TOKEN_BYTES } from './auth.constants';

/** Refresh tokens are stored only as this hash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/** A 6-digit code, 100000–999999, from a CSPRNG. */
export function sixDigitCode(): string {
  return String(randomInt(100000, 1000000));
}

/** The random 300–500 ms wait every failed check gets, so timing can't tell cases apart. */
export function failDelay(): Promise<void> {
  return sleep(FAIL_DELAY_MIN_MS + Math.random() * (FAIL_DELAY_MAX_MS - FAIL_DELAY_MIN_MS));
}
