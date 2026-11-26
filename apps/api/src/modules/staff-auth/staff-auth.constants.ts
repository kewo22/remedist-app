// Tunable settings for staff login, sessions and the login throttle.

/** Access tokens are short-lived; the refresh cookie gets a new one. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * A staff session lasts this long from login, however often it's refreshed: the same "log in
 * once a day" outcome as the old app's 12-hour token.
 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * A replaced refresh token presented again within this window is treated as two tabs refreshing
 * at once (409, retry) rather than theft (the whole chain is revoked).
 */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

export const REFRESH_COOKIE_NAME = 'remedist_staff_rt';
/** The cookie is only sent to the staff auth routes, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = '/api/v1/admin/auth';
export const REFRESH_TOKEN_BYTES = 32;

export const JWT_ISSUER = 'remedist-api';
export const JWT_AUDIENCE_STAFF = 'staff';

/** Same cost as the old app and the seed. */
export const BCRYPT_COST = 10;

// Login throttle, as in the old app (purpose 'admin_login' in auth.login_attempts).
export const LOGIN_THROTTLE_PURPOSE = 'admin_login';
export const LOGIN_LIMITS = {
  email15m: 5,
  email24h: 20,
  ip15m: 20,
  ip24h: 80,
} as const;
/** Every failed or throttled login waits a random 300–500 ms, so timing reveals nothing. */
export const FAIL_DELAY_MIN_MS = 300;
export const FAIL_DELAY_MAX_MS = 500;

export const MAX_USER_AGENT_LENGTH = 512;
