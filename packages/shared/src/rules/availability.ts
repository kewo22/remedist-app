// Rules for slots and session types, so the CRM forms, the booking page and the API agree.

/**
 * The universal booking notice (PRD B.2.4): the public slot list hides any slot starting less than
 * this far ahead. Staff, walk-in and pro-bono listings still see those slots.
 */
export const PUBLIC_BOOKING_CUTOFF_HOURS = 24;

/** True when a slot is too close to book from the public site. */
export function isInsidePublicCutoff(slotStart: Date, now: Date = new Date()): boolean {
  return slotStart.getTime() < now.getTime() + PUBLIC_BOOKING_CUTOFF_HOURS * 60 * 60 * 1000;
}

/** Session length limits, as in the old app (whole minutes). */
export const MIN_SESSION_MINUTES = 15;
export const MAX_SESSION_MINUTES = 480;
