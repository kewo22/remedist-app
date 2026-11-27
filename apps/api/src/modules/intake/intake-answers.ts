import {
  INTAKE_ANSWER_VALUES,
  INTAKE_MEASUREMENT_MAX_LENGTH,
  INTAKE_MEDICAL_QUESTIONS,
  INTAKE_TEXT_MAX_LENGTH,
  countWords,
  type ApiFieldError,
  type IntakeAnswers,
  type IntakeAnswerValue,
  type IntakeMedicalAnswer,
  type IntakeMedicalQuestionKey,
  type IntakeQuestionDefinition,
} from '@remedist/shared';

// Validates `answers` against the current question set (INTAKE_FORM_VERSION) and returns the
// cleaned answers, or one error per field with dotted paths (answers.medical.pacemaker.answer).
// Done here rather than with DTO classes because the questions come from packages/shared.

type ParseResult = { answers: IntakeAnswers; errors: [] } | { answers?: undefined; errors: ApiFieldError[] };

const ANSWER_KEYS = new Set(['weight', 'height', 'medical']);
const MEDICAL_ANSWER_KEYS = new Set(['answer', 'details']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed text with NUL characters removed (Postgres refuses them); empty becomes null. */
function cleanText(value: string): string | null {
  const text = value.replace(/\u0000/g, '').trim();
  return text === '' ? null : text;
}

/** An optional free-text value: undefined, null or '' mean "not given". */
function optionalText(value: unknown, maxLength: number, field: string, errors: ApiFieldError[]): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    errors.push({ field, messages: [`${field} must be text`] });
    return null;
  }
  const text = cleanText(value);
  if (text !== null && text.length > maxLength) {
    errors.push({ field, messages: [`Keep this to ${maxLength} characters or fewer`] });
  }
  return text;
}

function parseMedicalAnswer(
  question: IntakeQuestionDefinition,
  raw: unknown,
  errors: ApiFieldError[],
): IntakeMedicalAnswer | undefined {
  const field = `answers.medical.${question.key}`;
  if (!isRecord(raw)) {
    errors.push({ field: `${field}.answer`, messages: ['Please answer this question'] });
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!MEDICAL_ANSWER_KEYS.has(key)) {
      errors.push({ field: `${field}.${key}`, messages: [`property ${key} should not exist`] });
    }
  }
  const answer = raw.answer;
  if (typeof answer !== 'string' || !(INTAKE_ANSWER_VALUES as readonly string[]).includes(answer)) {
    errors.push({ field: `${field}.answer`, messages: [`Answer ${INTAKE_ANSWER_VALUES.join(', ')}`] });
    return undefined;
  }

  // Follow-up text is kept only for a "yes" to a question that has one, as in the old app.
  let details: string | null = null;
  if (question.details && answer === 'yes') {
    details = optionalText(raw.details, INTAKE_TEXT_MAX_LENGTH, `${field}.details`, errors);
    const maxWords = question.details.maxWords;
    if (details !== null && maxWords !== undefined && countWords(details) > maxWords) {
      errors.push({ field: `${field}.details`, messages: [`Use ${maxWords} words or fewer`] });
    }
  }
  return { answer: answer as IntakeAnswerValue, details };
}

export function parseIntakeAnswers(raw: unknown): ParseResult {
  const errors: ApiFieldError[] = [];
  if (!isRecord(raw)) {
    return { errors: [{ field: 'answers', messages: ['answers must be an object'] }] };
  }
  for (const key of Object.keys(raw)) {
    if (!ANSWER_KEYS.has(key)) {
      errors.push({ field: `answers.${key}`, messages: [`property ${key} should not exist`] });
    }
  }

  const weight = optionalText(raw.weight, INTAKE_MEASUREMENT_MAX_LENGTH, 'answers.weight', errors);
  const height = optionalText(raw.height, INTAKE_MEASUREMENT_MAX_LENGTH, 'answers.height', errors);

  const medicalRaw = raw.medical;
  if (!isRecord(medicalRaw)) {
    errors.push({ field: 'answers.medical', messages: ['Please answer the medical questions'] });
    return { errors };
  }
  const known = new Set<string>(INTAKE_MEDICAL_QUESTIONS.map((question) => question.key));
  for (const key of Object.keys(medicalRaw)) {
    if (!known.has(key)) {
      errors.push({ field: `answers.medical.${key}`, messages: ['This question isn’t on the form'] });
    }
  }

  const medical: Partial<Record<IntakeMedicalQuestionKey, IntakeMedicalAnswer>> = {};
  for (const question of INTAKE_MEDICAL_QUESTIONS) {
    const parsed = parseMedicalAnswer(question, medicalRaw[question.key], errors);
    if (parsed) {
      medical[question.key] = parsed;
    }
  }

  if (errors.length > 0) {
    return { errors };
  }
  return { answers: { weight, height, medical: medical as Record<IntakeMedicalQuestionKey, IntakeMedicalAnswer> }, errors: [] };
}
