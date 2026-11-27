// Part 2 intake (the health questionnaire): the versioned question set, its limits and the
// deadline. The API validates answers against the current version; the web builds the form from it.
// A new or changed question is a new INTAKE_FORM_VERSION, so old forms keep their meaning.

/** The question set clients answer now. Stored on every form as form_version. */
export const INTAKE_FORM_VERSION = 1;

/** Every screening question has three answers: "unknown" replaces the old app's unknown list. */
export const INTAKE_ANSWER_VALUES = ['yes', 'no', 'unknown'] as const;
export type IntakeAnswerValue = (typeof INTAKE_ANSWER_VALUES)[number];

export interface IntakeQuestionDefinition {
  /** The key in answers.medical. Never renamed once used. */
  readonly key: string;
  readonly label: string;
  /** "Yes" is pulled out as a highlighted warning on the pre-session document. */
  readonly critical: boolean;
  /** A free-text follow-up, asked only when the answer is "yes". */
  readonly details?: { readonly label: string; readonly maxWords?: number };
}

/** Version 1: the old app's medical checklist (PRD C.4.6.2), in its order. */
export const INTAKE_MEDICAL_QUESTIONS = [
  { key: 'pacemaker', label: 'Do you have a pacemaker?', critical: true },
  { key: 'osteoporosis', label: 'Do you have osteoporosis?', critical: true },
  { key: 'pregnant', label: 'Are you pregnant?', critical: true },
  { key: 'stroke_heart_history', label: 'Have you had a stroke or heart attack?', critical: true },
  { key: 'blood_thinners', label: 'Do you take blood thinners (Warfarin, Aspirin, etc.)?', critical: true },
  {
    key: 'surgery_last_5y',
    label: 'Have you had surgery in the last 5 years?',
    critical: false,
    details: { label: 'Which surgeries?' },
  },
  {
    key: 'incident_15y',
    label: 'Have you had an incident in the last 15+ years (accident, fall, sports injury, weightlifting, etc.)?',
    critical: false,
    details: { label: 'What happened? (10 words at most)', maxWords: 10 },
  },
  { key: 'allergies', label: 'Do you have any allergies?', critical: false, details: { label: 'Which allergies?' } },
] as const satisfies readonly IntakeQuestionDefinition[];

export type IntakeMedicalQuestionKey = (typeof INTAKE_MEDICAL_QUESTIONS)[number]['key'];

/** Weight and height are free text ("72 kg", "5 ft 9"), as in the old form. */
export const INTAKE_MEASUREMENT_MAX_LENGTH = 80;
/** Follow-up details and the problem description. */
export const INTAKE_TEXT_MAX_LENGTH = 2000;
/** The client picks their top pain points, ranked 1 (worst) to this. */
export const INTAKE_MAX_PAIN_POINTS = 3;

/** Words as the old app counted them: runs of non-space characters. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** The medical questions answered "yes" that the pre-session document highlights. */
export function criticalYesAnswers(
  medical: Partial<Record<IntakeMedicalQuestionKey, { answer: IntakeAnswerValue }>>,
): IntakeMedicalQuestionKey[] {
  return INTAKE_MEDICAL_QUESTIONS.filter((question) => question.critical && medical[question.key]?.answer === 'yes').map(
    (question) => question.key,
  );
}

/** Part 2 is due this long before the session (PRD C.4.6); later, it's done on paper on site. */
export const INTAKE_DEADLINE_HOURS_BEFORE_SESSION = 48;

export function intakeDeadline(sessionStart: Date): Date {
  return new Date(sessionStart.getTime() - INTAKE_DEADLINE_HOURS_BEFORE_SESSION * 60 * 60 * 1000);
}

/** The four optional posture photos. Internal use only, and never prefilled from an earlier visit. */
export const POSTURE_PHOTO_SIDES = ['front', 'back', 'left', 'right'] as const;
export type PosturePhotoSide = (typeof POSTURE_PHOTO_SIDES)[number];

/** As the old app's upload limit. */
export const INTAKE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const INTAKE_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type IntakePhotoContentType = (typeof INTAKE_PHOTO_CONTENT_TYPES)[number];
