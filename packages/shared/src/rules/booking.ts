// Booking rules, so the booking pages, the portal and the API agree. Times are instants; the
// appointment code uses the clinic-local date.
import { clinicDateOf } from './clinic-time';

/** A checkout hold keeps the slot this long; a 1-minute job releases expired holds. */
export const HOLD_MINUTES = 15;

/** A client may reschedule online only while the session is more than this far away (PRD B.6). */
export const SELF_RESCHEDULE_MIN_HOURS_BEFORE = 24;
/** ...to a slot within this many days of the booking's original session date (either direction). */
export const SELF_RESCHEDULE_WINDOW_DAYS = 30;

/** Cancelling a confirmed booking this close to the session is a late cancellation (a strike). */
export const LATE_CANCELLATION_HOURS = 24;
/** From this many strikes, a pay-after client raises a review notification (every strike after). */
export const PAY_AFTER_REVIEW_STRIKES = 2;
/** An unpaid pay-after session this many days old stops the client booking online. */
export const OVERDUE_LOCKOUT_DAYS = 30;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type SelfRescheduleBlock = 'not_confirmed' | 'already_used' | 'too_late';

/** Why the client can't reschedule this booking online, or undefined when they can. */
export function selfRescheduleBlock(
  booking: { status: string; start: Date; selfRescheduleUsed: boolean },
  now: Date = new Date(),
): SelfRescheduleBlock | undefined {
  if (booking.status !== 'confirmed') {
    return 'not_confirmed';
  }
  if (booking.selfRescheduleUsed) {
    return 'already_used';
  }
  if (booking.start.getTime() - now.getTime() <= SELF_RESCHEDULE_MIN_HOURS_BEFORE * HOUR_MS) {
    return 'too_late';
  }
  return undefined;
}

/** True when a new session time is within the 30-day window of the original session (either way). */
export function withinSelfRescheduleWindow(originalStart: Date, newStart: Date): boolean {
  return Math.abs(newStart.getTime() - originalStart.getTime()) <= SELF_RESCHEDULE_WINDOW_DAYS * DAY_MS;
}

/** True when cancelling a confirmed booking now counts as a late cancellation. */
export function isLateCancellation(start: Date, now: Date = new Date()): boolean {
  const until = start.getTime() - now.getTime();
  return until > 0 && until < LATE_CANCELLATION_HOURS * HOUR_MS;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The appointment code (PRD C.4.2): session date, P (paid) or B (pro-bono), the client's gender
 * (F, otherwise M), and that day's sequence: "02AUG26-PF03". Uses the clinic-local date.
 */
export function formatAppointmentCode(
  sessionStart: Date,
  bookingType: 'paid' | 'probono',
  gender: string | null,
  sequence: number,
): string {
  const [year, month, day] = clinicDateOf(sessionStart).split('-');
  const date = `${day}${MONTHS[Number(month) - 1]}${(year ?? '').slice(-2)}`;
  return `${date}-${bookingType === 'probono' ? 'B' : 'P'}${gender === 'F' ? 'F' : 'M'}${String(sequence).padStart(2, '0')}`;
}
