// Abuse limits for sending one-time codes, as in the old app (otpRateLimit.service.js). Every send
// costs money (Twilio) or sending reputation (Resend). DAILY_OTP_SEND_CAP and OTP_CODE_TTL_MINUTES
// are env vars; the rest are tuned here.

/** Sends per phone number or email (counted across every purpose, so switching purpose doesn't reset). */
export const IDENTIFIER_15M_MAX = 3;
export const IDENTIFIER_24H_MAX = 8;
/** Sends per IP address. */
export const IP_15M_MAX = 5;
export const IP_24H_MAX = 20;

/**
 * Wait before the nth send to the same identifier in 24 hours: index n-1, the last value repeats.
 * So the 1st send is free, the 2nd needs 60 s since the previous one, the 3rd 120 s, then 300 s.
 */
export const COOLDOWN_STEPS_SECONDS = [0, 60, 120, 300] as const;

/** Wrong guesses allowed per code; the last one uses the code up. */
export const MAX_VERIFY_ATTEMPTS = 5;

/** Email verification codes last longer than the rest, as in the old app. */
export const EMAIL_VERIFICATION_CODE_TTL_MINUTES = 15;
