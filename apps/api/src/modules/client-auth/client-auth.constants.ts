// Tunable settings for client (patient portal) sign-in. Shared ones are in
// common/auth/auth.constants.ts; code-sending limits in modules/otp/otp.constants.ts.

import type { AttemptLimits } from '../../common/auth/auth.constants';

/** A client session lasts this long from sign-in, however often it's refreshed: the old 7-day token. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const REFRESH_COOKIE_NAME = 'remedist_client_rt';
/** The cookie is only sent to the portal auth routes, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = '/api/v1/portal/auth';

export const JWT_AUDIENCE_CLIENT = 'client';

/** auth.login_attempts purposes, as in the old app. */
export const LOGIN_THROTTLE_PURPOSE = 'login';
export const EMAIL_VERIFY_THROTTLE_PURPOSE = 'email_verify';

/** Wrong email-verification codes: 5 per email in 15 minutes and in 24 hours, 20/80 per IP. */
export const EMAIL_VERIFY_LIMITS: AttemptLimits = { email15m: 5, email24h: 5, ip15m: 20, ip24h: 80 };
