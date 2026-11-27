// Contacts: every person the clinic deals with, leads included. The client's own profile and
// dependents in the portal, and the CRM client list, detail and staff edits.
//
// Dates of birth are "YYYY-MM-DD"; timestamps are ISO 8601. Phone numbers are "+<digits>".
// In update requests, an omitted field keeps its value and null clears it.

export const CONTACT_STAGES = ['new', 'nurturing', 'booked', 'patient'] as const;
export type ContactStage = (typeof CONTACT_STAGES)[number];

export const CONTACT_SOURCES = ['website', 'walk_in', 'probono', 'staff', 'import'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/** As the old Part 1 form: M or F. */
export const CONTACT_GENDERS = ['M', 'F'] as const;
export type ContactGender = (typeof CONTACT_GENDERS)[number];

export const ID_TYPES = ['nic', 'passport'] as const;
export type IdType = (typeof ID_TYPES)[number];

export const DEPENDENT_RELATIONSHIPS = ['child', 'parent', 'spouse', 'sibling', 'other'] as const;
export type DependentRelationship = (typeof DEPENDENT_RELATIONSHIPS)[number];

// ── Client portal ──────────────────────────────────────────────────────────────────────────

export const PORTAL_PROFILE_ROUTES = {
  /**
   * GET → ClientContactProfile. Optional ?contactId= for one of the account's dependents
   * (default: the account holder). FORBIDDEN for anyone else's contact.
   */
  profile: '/portal/profile',
  /** GET → DependentSummary[]. POST CreateDependentRequest → DependentSummary (201). */
  dependents: '/portal/dependents',
} as const;

/**
 * The details a client sees on their own profile (or a dependent's). The identity fields are
 * locked once Part 1 is complete: only the clinic can correct them.
 */
export interface ClientContactProfile {
  contactId: string;
  /** REM-0001..., assigned at Part 1 completion; null before. */
  registrationNumber: string | null;
  /** True once Part 1 registration is complete. Until then the profile can't be edited. */
  part1Completed: boolean;
  /** True when this is one of the account's dependents rather than the account holder. */
  isDependent: boolean;

  // Locked after Part 1.
  name: string;
  gender: ContactGender | null;
  /** ISO 3166-1 alpha-2, e.g. "LK". */
  nationality: string | null;
  idType: IdType | null;
  idNumber: string | null;
  dateOfBirth: string | null;

  // Editable after Part 1 (PATCH profile), except email.
  /** Shown, not editable here: for the account holder it's also their login email. */
  email: string | null;
  phone: string | null;
  profession: string | null;
  address: string | null;
  backupContactName: string | null;
  backupContactRelation: string | null;
  backupContactPhone: string | null;
}

/**
 * PATCH profile. Needs Part 1 complete (PART1_INCOMPLETE otherwise). Changing `phone` to a new
 * number needs `phoneVerificationToken` from PHONE_OTP_ROUTES.verify with purpose
 * 'phone_change' for that number (PHONE_NOT_VERIFIED otherwise). Clearing it (null) doesn't.
 */
export interface UpdateClientProfileRequest {
  /** A dependent's contact id; omit for the account holder. */
  contactId?: string;
  phone?: string | null;
  phoneVerificationToken?: string;
  profession?: string | null;
  address?: string | null;
  backupContactName?: string | null;
  backupContactRelation?: string | null;
  backupContactPhone?: string | null;
}

export interface DependentSummary {
  contactId: string;
  name: string;
  relationship: DependentRelationship;
  registrationNumber: string | null;
  part1Completed: boolean;
}

/** Creates a bare profile; the client then completes Part 1 for it with its contactId. */
export interface CreateDependentRequest {
  name: string;
  relationship: DependentRelationship;
}

// ── CRM ────────────────────────────────────────────────────────────────────────────────────

/** Staff with patients.manage, except where a route says otherwise. */
export const ADMIN_CLIENT_ROUTES = {
  /** GET ClientListQuery → ClientListItem[], with meta ClientListMeta. */
  list: '/admin/clients',
  /** GET ?q= → ClientLookupItem[] (at most 10). For "Referred by" and other pickers. */
  lookup: '/admin/clients/lookup',
  /** GET → ClientDetail. PATCH StaffUpdateClientRequest → ClientDetail. Replace :id. */
  client: '/admin/clients/:id',
  /** PATCH CorrectIdentityRequest → ClientDetail. Needs patients.correct_identity (owners). */
  identity: '/admin/clients/:id/identity',
  /** PATCH UpdateReferralRequest → ClientDetail. */
  referral: '/admin/clients/:id/referral',
  /** PATCH UpdatePaymentSettingsRequest → ClientDetail. Needs billing.manage. */
  paymentSettings: '/admin/clients/:id/payment-settings',
} as const;

export const CLIENT_LIST_SORT_FIELDS = ['updatedAt', 'createdAt', 'name', 'registrationNumber'] as const;
export type ClientListSortField = (typeof CLIENT_LIST_SORT_FIELDS)[number];

export const CLIENT_LIST_MAX_PAGE_SIZE = 100;

/** Query string for the client list. All optional. */
export interface ClientListQuery {
  /**
   * Matches name, email, registration number or NIC/passport number (contains, any case), or
   * the phone number by its digits.
   */
  q?: string;
  stage?: ContactStage;
  /** Default false: archived contacts are left out. */
  includeArchived?: boolean;
  /** Default 1. */
  page?: number;
  /** Default 25, at most CLIENT_LIST_MAX_PAGE_SIZE. */
  pageSize?: number;
  /** Default updatedAt (most recently touched first, as the old pipeline). */
  sortBy?: ClientListSortField;
  /** Default desc. */
  sortDir?: 'asc' | 'desc';
}

export interface ClientListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ClientListItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  registrationNumber: string | null;
  stage: ContactStage;
  source: ContactSource;
  /** Has a portal login. */
  hasAccount: boolean;
  payAfterSession: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientLookupItem {
  id: string;
  name: string;
  registrationNumber: string | null;
}

export interface ClientAccountSummary {
  /** The login email (the same address as the contact's). */
  email: string;
  authProvider: 'email' | 'google';
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** A change to the locked identity fields, from audit_log. */
export interface IdentityCorrection {
  changedAt: string;
  changedBy: string;
  /** Only the fields that changed. */
  before: Partial<Record<CorrectableIdentityField, string | null>>;
  after: Partial<Record<CorrectableIdentityField, string | null>>;
  note: string | null;
}

export interface ClientDetail {
  id: string;
  registrationNumber: string | null;
  stage: ContactStage;
  source: ContactSource;
  part1CompletedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;

  name: string;
  gender: ContactGender | null;
  nationality: string | null;
  /** 'lk' pays LKR when nationality isn't known yet. Follows nationality once it is. */
  residency: 'lk' | 'intl';
  idType: IdType | null;
  idNumber: string | null;
  dateOfBirth: string | null;

  email: string | null;
  phone: string | null;
  profession: string | null;
  address: string | null;
  backupContactName: string | null;
  backupContactRelation: string | null;
  backupContactPhone: string | null;

  /** The client's own "how did you hear about us" answer. */
  referralText: string | null;
  referredBy: ClientLookupItem | null;
  /** A best guess from referralText when referredBy isn't set, for one-click confirmation. */
  suggestedReferral: ClientLookupItem | null;

  payAfterSession: boolean;
  reminderFrequencyDays: number;
  termsAcceptedAt: string | null;
  termsAcceptedVersion: number | null;

  /** Null when the contact has no portal login. */
  account: ClientAccountSummary | null;
  /** When this contact is someone's dependent: the account holder's contact. */
  managedBy: ClientLookupItem | null;
  /** People this contact's account manages. */
  dependents: (ClientLookupItem & { relationship: DependentRelationship })[];
  /** No-shows and late cancellations. */
  strikeCount: number;
  /** Newest first. */
  identityCorrections: IdentityCorrection[];
}

/**
 * PATCH client. The editable details and the pipeline stage; every change is audited.
 * `name` only while Part 1 isn't complete (afterwards it's an identity correction).
 * `email` is refused with CONTACT_EMAIL_LOCKED when the contact has a portal login.
 */
export interface StaffUpdateClientRequest {
  name?: string;
  email?: string | null;
  phone?: string | null;
  profession?: string | null;
  address?: string | null;
  backupContactName?: string | null;
  backupContactRelation?: string | null;
  backupContactPhone?: string | null;
  stage?: ContactStage;
}

export const CORRECTABLE_IDENTITY_FIELDS = ['name', 'gender', 'nationality', 'idType', 'idNumber', 'dateOfBirth'] as const;
export type CorrectableIdentityField = (typeof CORRECTABLE_IDENTITY_FIELDS)[number];

/**
 * PATCH identity: correct the locked Part 1 fields. At least one field. idType and idNumber are
 * set or cleared together. Changing nationality moves residency with it.
 */
export interface CorrectIdentityRequest {
  name?: string;
  gender?: ContactGender;
  nationality?: string;
  idType?: IdType | null;
  idNumber?: string | null;
  dateOfBirth?: string;
  /** Why, for the record. */
  note?: string;
}

export interface UpdateReferralRequest {
  /** Another contact's id, or null to clear. */
  referredByContactId: string | null;
}

/** At least one field. Credit and balances aren't editable: they come from the payment ledger. */
export interface UpdatePaymentSettingsRequest {
  payAfterSession?: boolean;
  /** Days between payment reminders, MIN_REMINDER_FREQUENCY_DAYS to MAX_REMINDER_FREQUENCY_DAYS. */
  reminderFrequencyDays?: number;
}
