// Clinic local time. Staff type dates and times as the clinic sees them ("YYYY-MM-DD", "HH:MM");
// the API stores instants (timestamptz). Sri Lanka has one fixed offset all year (no daylight
// saving), so converting needs no time-zone database.

/** IANA name, for display (Intl.DateTimeFormat) and SQL (AT TIME ZONE). */
export const CLINIC_TIME_ZONE = 'Asia/Colombo';
/** Asia/Colombo's offset, all year. */
export const CLINIC_UTC_OFFSET = '+05:30';
const CLINIC_OFFSET_MINUTES = 5 * 60 + 30;

/** The instant of a clinic-local date and time. Inputs must already be valid (isDateOnly, isTimeOfDay). */
export function clinicDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${CLINIC_UTC_OFFSET}`);
}

function clinicShifted(instant: Date): string {
  return new Date(instant.getTime() + CLINIC_OFFSET_MINUTES * 60_000).toISOString();
}

/** The clinic-local calendar date of an instant, "YYYY-MM-DD". */
export function clinicDateOf(instant: Date): string {
  return clinicShifted(instant).slice(0, 10);
}

/** The clinic-local time of day of an instant, "HH:MM". */
export function clinicTimeOf(instant: Date): string {
  return clinicShifted(instant).slice(11, 16);
}

/** A "YYYY-MM-DD" date moved by whole days (negative goes back). */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
