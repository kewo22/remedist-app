// Rules for client (patient portal) accounts, so the sign-up form and the API agree.

/** The old app's minimum, kept as is. */
export const CLIENT_PASSWORD_MIN_LENGTH = 6;
/** bcrypt only reads the first 72 bytes; the cap also stops huge bodies being hashed. */
export const PASSWORD_MAX_LENGTH = 200;

/** Verification and reset codes are 6 digits. */
export const ONE_TIME_CODE_PATTERN = /^\d{6}$/;

/** Emails are compared trimmed and lower-cased everywhere. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
