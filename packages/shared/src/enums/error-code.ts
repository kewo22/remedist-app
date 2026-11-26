// Stable machine-readable error codes. The API sends one in every error response
// (`ApiError.errorCode`) and the web app branches on it, never on the message text.
// Domains add their own codes here as they're built (for example SLOT_UNAVAILABLE).
// Never rename or reuse a code once it ships.

export const ErrorCode = {
  // Generic codes, mapped from the HTTP status when nothing more specific applies.
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  UNPROCESSABLE: 'UNPROCESSABLE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Auth
  /** Wrong email or password. Deliberately doesn't say which. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** The access token or refresh session is missing, expired or revoked: sign in again. */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** Another tab refreshed the session a moment ago: retry the refresh once. */
  REFRESH_CONFLICT: 'REFRESH_CONFLICT',
  /** This login needs two-factor authentication, which isn't available yet. */
  MFA_REQUIRED: 'MFA_REQUIRED',
  /** A verification or reset code is wrong, used up or expired. Deliberately doesn't say which. */
  INVALID_CODE: 'INVALID_CODE',
  /** Show the Turnstile check and send its token with the retry. */
  CHALLENGE_REQUIRED: 'CHALLENGE_REQUIRED',
  /** Google didn't accept the sign-in, or the Google account's email isn't verified. */
  GOOGLE_SIGN_IN_FAILED: 'GOOGLE_SIGN_IN_FAILED',
  /** That delivery channel (for example a reset code by phone) isn't available. */
  CHANNEL_UNAVAILABLE: 'CHANNEL_UNAVAILABLE',
  /** A phone code is used up or expired: request a new one. (A wrong guess is INVALID_CODE.) */
  CODE_EXPIRED: 'CODE_EXPIRED',
  /** A phone verification token is missing, invalid, expired or for another purpose. */
  PHONE_NOT_VERIFIED: 'PHONE_NOT_VERIFIED',
  /**
   * A verified phone has no portal account. Safe to say: the person just proved they own the number.
   */
  PHONE_ACCOUNT_NOT_FOUND: 'PHONE_ACCOUNT_NOT_FOUND',
  /** More than one portal account has this phone (for example family members): sign in by email. */
  PHONE_ACCOUNT_AMBIGUOUS: 'PHONE_ACCOUNT_AMBIGUOUS',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
