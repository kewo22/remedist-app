// Terms & Conditions: one draft that staff edit, published as numbered versions that never change.
// Clients accept once; after a newer version is published they accept again before their next
// booking (termsAcceptanceRequired). Timestamps are ISO 8601.

export const PUBLIC_TERMS_ROUTES = {
  /** GET → PublishedTerms. TERMS_NOT_PUBLISHED (404) before the first publish. */
  current: '/public/terms/current',
} as const;

export const PORTAL_TERMS_ROUTES = {
  /** GET → TermsConsentStatus. Optional ?contactId= for a dependent. */
  status: '/portal/terms/status',
  /** POST AcceptTermsRequest → TermsConsentStatus. Re-consent for a returning client. */
  accept: '/portal/terms/accept',
} as const;

/** CRM. content.manage edits the draft; publishing also needs settings.manage (owners). */
export const ADMIN_TERMS_ROUTES = {
  /** GET → TermsDraft. PUT UpdateTermsDraftRequest → TermsDraft. */
  draft: '/admin/terms/draft',
  /** POST (no body) → TermsVersion. TERMS_INCOMPLETE if either section is empty. */
  publish: '/admin/terms/publish',
  /** GET → TermsVersion[], newest first. */
  history: '/admin/terms/history',
} as const;

export interface PublishedTerms {
  version: number;
  generalTermsContent: string;
  refundPolicyContent: string;
  publishedAt: string;
}

/** A published version as the CRM lists it. */
export interface TermsVersion extends PublishedTerms {
  /** The staff member's name; null if that login no longer exists. */
  publishedBy: string | null;
}

export interface TermsDraft {
  generalTermsContent: string;
  refundPolicyContent: string;
  updatedAt: string;
  /** The version a publish would create. */
  nextVersion: number;
}

/** Both sections are replaced; at most TERMS_SECTION_MAX_LENGTH characters each. */
export interface UpdateTermsDraftRequest {
  generalTermsContent: string;
  refundPolicyContent: string;
}

export interface TermsConsentStatus {
  contactId: string;
  acceptedVersion: number | null;
  acceptedAt: string | null;
  /** The latest published version; null before the first publish. */
  currentVersion: number | null;
  /** True when the client must accept the current version before booking. */
  acceptanceRequired: boolean;
}

/**
 * Both checkboxes must be ticked. `termsVersion` is the version shown to the client; if a newer one
 * was published meanwhile, TERMS_VERSION_OUTDATED.
 */
export interface AcceptTermsRequest {
  /** A dependent's contact id; omit for the account holder. */
  contactId?: string;
  termsVersion: number;
  acceptGeneralTerms: true;
  acceptRefundPolicy: true;
}
