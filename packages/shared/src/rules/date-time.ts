// Calendar dates and times of day as the clinic writes them: "YYYY-MM-DD" and 24-hour "HH:MM",
// both in clinic local time. Kept as strings so no timezone conversion can shift them.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a real calendar date in "YYYY-MM-DD" form (rejects 2026-02-30). */
export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** True for a 24-hour "HH:MM" time, 00:00 to 23:59. */
export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY.test(value);
}
