// Tunable values for bookings. The business rules (hold length, reschedule window, strikes) are in
// packages/shared/rules/booking.ts so the web app agrees.

export const BOOKING_LIST_DEFAULT_PAGE_SIZE = 50;
/** The client's notes and staff notes. */
export const BOOKING_NOTES_MAX_LENGTH = 2000;
/** Expired holds released per job run (the rest go on the next minute). */
export const HOLD_RELEASE_BATCH_SIZE = 100;
/** pg_try_advisory_xact_lock key for the hold-release job. */
export const HOLD_RELEASE_LOCK_KEY = 4_200_902;
/** Walk-in slots made on the spot start on the next quarter hour (never at odd minutes). */
export const WALK_IN_START_STEP_MINUTES = 15;

/** audit_log actions written by this domain. */
export const BOOKING_AUDIT_ACTION = {
  created: 'booking.created',
  rescheduled: 'booking.rescheduled',
  cancelled: 'booking.cancelled',
  holdExpired: 'booking.hold_expired',
  noShow: 'booking.no_show',
  staffNotesUpdated: 'booking.staff_notes_updated',
} as const;

export const SLOT_BOOKING_ACTION = {
  booked: 'slot.booked',
  released: 'slot.released',
} as const;
