// Tunable values for the contacts domain.

/** Client list page size when none is asked for. The maximum is CLIENT_LIST_MAX_PAGE_SIZE (shared). */
export const CLIENT_LIST_DEFAULT_PAGE_SIZE = 25;

/** Results for the client picker (the old typeahead returned 10). */
export const CLIENT_LOOKUP_LIMIT = 10;

/** Identity corrections shown on the client detail. */
export const IDENTITY_CORRECTIONS_LIMIT = 50;

/** audit_log actions written by this domain. */
export const AUDIT_ACTION = {
  updated: 'contact.updated',
  profileUpdated: 'contact.profile_updated',
  identityCorrected: 'contact.identity_corrected',
  referralChanged: 'contact.referral_changed',
  paymentSettingsChanged: 'contact.payment_settings_changed',
  dependentAdded: 'contact.dependent_added',
} as const;

/**
 * Words ignored when guessing a referrer from "how did you hear about us", as in the old app:
 * relationship words and filler, so "my friend Nimal at work" looks for "Nimal".
 */
export const REFERRAL_STOPWORDS: ReadonlySet<string> = new Set([
  'my', 'the', 'a', 'an', 'and', 'or', 'friend', 'family', 'sister', 'brother', 'cousin',
  'mom', 'mum', 'dad', 'mother', 'father', 'colleague', 'coworker', 'neighbour', 'neighbor',
  'doctor', 'dr', 'told', 'me', 'about', 'you', 'us', 'heard', 'from', 'via', 'through',
  'recommended', 'referred', 'by', 'saw', 'said', 'was', 'is', 'at', 'on', 'in', 'work',
  'gym', 'clinic', 'she', 'he', 'they', 'them', 'her', 'his', 'their',
]);

/** Shortest word worth matching against names. */
export const REFERRAL_MIN_WORD_LENGTH = 3;
