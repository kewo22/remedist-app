// Rules for contacts (clients and leads) and Part 1 registration, so the forms and the API agree.

/**
 * NIC and passport numbers are stored trimmed and upper-cased, so "ab123456", " AB123456 " and
 * "AB123456" are one person. Empty after trimming means "not given" (dependents may omit it).
 */
export function normalizeIdNumber(raw: string): string | null {
  const normalized = raw.trim().toUpperCase();
  return normalized === '' ? null : normalized;
}

/** The permanent client number assigned at Part 1 completion: REM-0001, REM-0002... */
export const REGISTRATION_NUMBER_PREFIX = 'REM-';

export function formatRegistrationNumber(sequence: number): string {
  return `${REGISTRATION_NUMBER_PREFIX}${String(sequence).padStart(4, '0')}`;
}

/** The nationality that pays in LKR (ISO 3166-1 alpha-2). */
export const LOCAL_NATIONALITY = 'LK';

/**
 * contacts.residency, kept in step with nationality: Sri Lankan nationals are 'lk', everyone else
 * 'intl'. Residency is only the fallback for a lead whose nationality isn't known yet.
 */
export function residencyForNationality(nationality: string): 'lk' | 'intl' {
  return nationality.trim().toUpperCase() === LOCAL_NATIONALITY ? 'lk' : 'intl';
}

/** Payment reminders for pay-after-session clients: every N days, at least 1. */
export const MIN_REMINDER_FREQUENCY_DAYS = 1;
/** An input sanity cap, not a business rule: the old app had no upper limit. */
export const MAX_REMINDER_FREQUENCY_DAYS = 365;
