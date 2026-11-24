// Phone numbers are stored and compared in one form: "+" followed by digits (E.164 style).

/** E.164 allows at most 15 digits; 7 is the shortest real subscriber number with a country code. */
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/**
 * Same outcome as the old app: drop everything except digits and "+", then make sure
 * it starts with "+". `" +94 77-123 4567 "` → `"+94771234567"`. Empty input gives "".
 */
export function normalizePhone(raw: string): string {
  const kept = raw.trim().replace(/[^\d+]/g, '');
  if (kept === '') {
    return '';
  }
  return kept.startsWith('+') ? kept : `+${kept}`;
}

/** True for a normalised number: "+" then 7–15 digits, not starting with 0. */
export function isValidPhone(normalized: string): boolean {
  return new RegExp(`^\\+[1-9]\\d{${PHONE_MIN_DIGITS - 1},${PHONE_MAX_DIGITS - 1}}$`).test(normalized);
}
