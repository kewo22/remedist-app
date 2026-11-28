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

  // Webhooks
  /** A webhook's signature didn't match: the request isn't from the provider. */
  INVALID_WEBHOOK_SIGNATURE: 'INVALID_WEBHOOK_SIGNATURE',

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

  // Contacts
  /** The profile can't be edited until Part 1 registration is complete. */
  PART1_INCOMPLETE: 'PART1_INCOMPLETE',
  /** That NIC or passport number is already registered to another client. */
  DUPLICATE_ID_NUMBER: 'DUPLICATE_ID_NUMBER',
  /** Another contact already has that email. */
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  /** The client signs in with this email, so staff can't change it from the CRM. */
  CONTACT_EMAIL_LOCKED: 'CONTACT_EMAIL_LOCKED',

  // Availability
  /** The slot overlaps another of that practitioner's slots. */
  SLOT_OVERLAP: 'SLOT_OVERLAP',
  /** The slot's status doesn't allow that change (for example editing a booked slot). */
  SLOT_STATUS_CONFLICT: 'SLOT_STATUS_CONFLICT',
  /** That session type is retired: pick another. */
  SESSION_TYPE_RETIRED: 'SESSION_TYPE_RETIRED',
  /** At least one session type must stay active. */
  LAST_SESSION_TYPE: 'LAST_SESSION_TYPE',
  /** Another session type already has that name. */
  SESSION_TYPE_NAME_TAKEN: 'SESSION_TYPE_NAME_TAKEN',
  // Intake and terms
  /** Part 1 registration is already complete for this profile. */
  PART1_ALREADY_COMPLETED: 'PART1_ALREADY_COMPLETED',
  /** No Terms & Conditions have been published yet. */
  TERMS_NOT_PUBLISHED: 'TERMS_NOT_PUBLISHED',
  /** The terms version the client accepted isn't the current one: reload the terms and accept again. */
  TERMS_VERSION_OUTDATED: 'TERMS_VERSION_OUTDATED',
  /** Both sections of the terms draft need content before it can be published. */
  TERMS_INCOMPLETE: 'TERMS_INCOMPLETE',
  /** The uploaded file isn't a JPEG, PNG or WebP image. */
  INVALID_PHOTO: 'INVALID_PHOTO',

  // Google Calendar
  /** The server has no Google client settings, so the calendar can't be connected. */
  CALENDAR_NOT_CONFIGURED: 'CALENDAR_NOT_CONFIGURED',
  /** No Google Calendar is connected. */
  CALENDAR_NOT_CONNECTED: 'CALENDAR_NOT_CONNECTED',
  /** A calendar sync is already running: try again in a moment. */
  CALENDAR_SYNC_BUSY: 'CALENDAR_SYNC_BUSY',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
