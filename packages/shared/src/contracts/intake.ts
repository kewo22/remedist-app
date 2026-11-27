// Two-stage intake. Part 1 is the one-time registration (identity, contact details, consent);
// Part 2 is the health questionnaire, one per visit, with optional posture photos.
//
// Dates of birth are "YYYY-MM-DD"; timestamps are ISO 8601. Phone numbers are "+<digits>".

import type {
  INTAKE_FORM_VERSION,
  IntakeAnswerValue,
  IntakeMedicalQuestionKey,
  IntakePhotoContentType,
  PosturePhotoSide,
} from '../rules/intake';
import type { ContactGender, IdType } from './contacts';

// ── Routes ─────────────────────────────────────────────────────────────────────────────────

export const PUBLIC_INTAKE_ROUTES = {
  /** GET → TopNationalities. The most common nationalities on file, for the Part 1 dropdown. */
  nationalities: '/public/intake/nationalities',
  /** GET → AnatomySegment[]. The pain-point diagram's segments, in display order. */
  anatomySegments: '/public/intake/anatomy-segments',
} as const;

export const PORTAL_INTAKE_ROUTES = {
  /**
   * POST CompletePart1Request → ClientContactProfile. Once per contact (own or a dependent's):
   * locks the identity fields, records consent and assigns the registration number.
   */
  part1: '/portal/intake/part1',
  /** GET → IntakeFormSummary[], newest first. Optional ?contactId= for a dependent. */
  forms: '/portal/intake/forms',
  /** GET → IntakeForm. PUT SubmitIntakeRequest → IntakeForm (submit, or edit after submitting). */
  form: '/portal/intake/forms/:intakeId',
  /**
   * PUT multipart/form-data with one file field "photo" → IntakePhoto. Replaces any earlier photo
   * for that side. JPEG, PNG or WebP, up to INTAKE_PHOTO_MAX_BYTES.
   */
  photo: '/portal/intake/forms/:intakeId/photos/:side',
  /** GET → IntakePrefill | null. The last completed form's answers, for a repeat visit. ?contactId= */
  prefill: '/portal/intake/prefill',
} as const;

/** CRM. Viewing needs clinical.read, entering a paper form needs clinical.write. Every access is logged. */
export const ADMIN_INTAKE_ROUTES = {
  /** GET → IntakeFormSummary[] for one client, newest first. */
  clientForms: '/admin/clients/:contactId/intake-forms',
  /** GET → IntakePrefill | null, for typing in a paper form on site. */
  clientPrefill: '/admin/clients/:contactId/intake-prefill',
  /** GET → IntakeForm. PUT SubmitIntakeRequest → IntakeForm (the on-site paper form). */
  form: '/admin/intake-forms/:intakeId',
  /** GET → the image itself (not the JSON envelope). */
  photo: '/admin/intake-forms/:intakeId/photos/:side',
} as const;

// ── Part 1 ─────────────────────────────────────────────────────────────────────────────────

export interface TopNationalities {
  /** ISO 3166-1 alpha-2 codes, most common first (at most 10). */
  topNationalities: string[];
}

/**
 * Part 1 registration. Name, gender, nationality, ID and date of birth are locked once it's done.
 * Both terms checkboxes must be ticked, and `termsVersion` must be the version the client was shown
 * (PUBLIC_TERMS_ROUTES.current); TERMS_VERSION_OUTDATED if a newer one was published meanwhile.
 */
export interface CompletePart1Request {
  /** A dependent's contact id; omit for the account holder. */
  contactId?: string;
  name: string;
  gender: ContactGender;
  /** ISO 3166-1 alpha-2. "LK" pays in LKR, everyone else in USD. */
  nationality: string;
  /** Required for the account holder; a dependent may leave both null. Set or clear together. */
  idType: IdType | null;
  idNumber: string | null;
  dateOfBirth: string;
  /**
   * Dependents only: the account holder's email is their login and is already on file. EMAIL_IN_USE
   * if another client has it.
   */
  email?: string | null;
  /** A new number needs phoneVerificationToken (purpose 'phone_change') for it. */
  phone?: string | null;
  phoneVerificationToken?: string;
  profession?: string | null;
  address?: string | null;
  backupContactName?: string | null;
  backupContactRelation?: string | null;
  backupContactPhone?: string | null;
  /** "How did you hear about us?" */
  referralText?: string | null;
  /** The published version shown to the client; null only when none has been published. */
  termsVersion: number | null;
  acceptGeneralTerms: true;
  acceptRefundPolicy: true;
}

// ── Part 2 ─────────────────────────────────────────────────────────────────────────────────

export const INTAKE_STATUSES = ['pending', 'completed', 'missed_deadline_onsite'] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const INTAKE_COMPLETED_VIA = ['online', 'walk_in_tablet', 'onsite_manual'] as const;
export type IntakeCompletedVia = (typeof INTAKE_COMPLETED_VIA)[number];

export const ANATOMY_CATEGORIES = ['head', 'frontside', 'backside', 'side'] as const;
export type AnatomyCategory = (typeof ANATOMY_CATEGORIES)[number];

export interface AnatomySegment {
  id: string;
  category: AnatomyCategory;
  name: string;
  displayOrder: number;
}

export interface IntakeMedicalAnswer {
  answer: IntakeAnswerValue;
  /** The follow-up text; only kept when the answer is "yes" and the question has a follow-up. */
  details: string | null;
}

/** Answers to INTAKE_FORM_VERSION 1. Every medical question must be answered. */
export interface IntakeAnswers {
  weight: string | null;
  height: string | null;
  medical: Record<IntakeMedicalQuestionKey, IntakeMedicalAnswer>;
}

export interface IntakePainPointInput {
  segmentId: string;
  /** 1 is the worst. Ranks are unique, from 1 to INTAKE_MAX_PAIN_POINTS. */
  rank: number;
}

export interface IntakePainPoint extends IntakePainPointInput {
  segmentName: string;
  category: AnatomyCategory;
}

export interface SubmitIntakeRequest {
  /** The question set answered; must be the current INTAKE_FORM_VERSION. */
  formVersion: typeof INTAKE_FORM_VERSION;
  answers: IntakeAnswers;
  /** Up to INTAKE_MAX_PAIN_POINTS, each segment once. */
  painPoints: IntakePainPointInput[];
  problemDescription: string | null;
}

export interface IntakeFormSummary {
  id: string;
  contactId: string;
  bookingId: string | null;
  probonoEntryId: string | null;
  /** The booked session's start; null for a pro-bono application not yet given a slot. */
  sessionStart: string | null;
  /** INTAKE_DEADLINE_HOURS_BEFORE_SESSION before the session; null without one. */
  deadline: string | null;
  status: IntakeStatus;
  completedAt: string | null;
  completedVia: IntakeCompletedVia | null;
}

export interface IntakePhoto {
  side: PosturePhotoSide;
  contentType: IntakePhotoContentType;
  sizeBytes: number;
  uploadedAt: string;
}

export interface IntakeForm extends IntakeFormSummary {
  formVersion: number;
  /** Null until the form is first submitted. */
  answers: IntakeAnswers | null;
  painPoints: IntakePainPoint[];
  problemDescription: string | null;
  photos: IntakePhoto[];
}

/** From the client's last completed form, for a repeat visit. Photos are never prefilled. */
export interface IntakePrefill {
  fromIntakeId: string;
  completedAt: string;
  answers: IntakeAnswers;
  painPoints: IntakePainPoint[];
  problemDescription: string | null;
}
