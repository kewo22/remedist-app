// Tunable values for the intake domain. The question set and its limits are in packages/shared
// (rules/intake.ts), so the form and the API agree.

/** How many nationalities the Part 1 dropdown's "most common" group shows (as the old app). */
export const TOP_NATIONALITIES_LIMIT = 10;

/** Storage key prefix for posture photos: intake-photos/<intakeId>/<side>-<uuid>.<ext>. */
export const INTAKE_PHOTO_KEY_PREFIX = 'intake-photos';

/** audit_log actions written by this domain. Never put answers or other clinical text in them. */
export const INTAKE_AUDIT_ACTION = {
  part1Completed: 'contact.part1_completed',
  submitted: 'intake.submitted',
  photoUploaded: 'intake.photo_uploaded',
} as const;
