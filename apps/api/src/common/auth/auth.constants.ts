// Settings shared by staff and client sign-in. Per-audience ones (session length, cookie name,
// throttle purpose) live in each auth module's constants file.

/** Access tokens are short-lived; the refresh cookie gets a new one. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * A replaced refresh token presented again within this window is treated as two tabs refreshing
 * at once (409, retry) rather than theft (the whole chain is revoked).
 */
export const REFRESH_REUSE_GRACE_SECONDS = 10;
export const REFRESH_TOKEN_BYTES = 32;

export const JWT_ISSUER = 'remedist-api';

/** Same cost as the old app and the seed, so old hashes and new ones verify the same way. */
export const BCRYPT_COST = 10;

/** Every failed or throttled check waits a random 300–500 ms, so timing reveals nothing. */
export const FAIL_DELAY_MIN_MS = 300;
export const FAIL_DELAY_MAX_MS = 500;

export const MAX_USER_AGENT_LENGTH = 512;

/** Rolling windows of failed attempts allowed before a 429. */
export interface AttemptLimits {
  email15m: number;
  email24h: number;
  ip15m: number;
  ip24h: number;
}

/** Password login, staff and client alike (as in the old app). */
export const LOGIN_LIMITS: AttemptLimits = { email15m: 5, email24h: 20, ip15m: 20, ip24h: 80 };
