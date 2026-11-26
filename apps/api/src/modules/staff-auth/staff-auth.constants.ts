// Tunable settings for staff login. Shared ones (access-token lifetime, refresh grace, fail delay,
// login limits) are in common/auth/auth.constants.ts.

/**
 * A staff session lasts this long from login, however often it's refreshed: the same "log in
 * once a day" outcome as the old app's 12-hour token.
 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export const REFRESH_COOKIE_NAME = 'remedist_staff_rt';
/** The cookie is only sent to the staff auth routes, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = '/api/v1/admin/auth';

export const JWT_AUDIENCE_STAFF = 'staff';

/** auth.login_attempts purpose for staff password failures, as in the old app. */
export const LOGIN_THROTTLE_PURPOSE = 'admin_login';
