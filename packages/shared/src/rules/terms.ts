// Terms & Conditions consent. Accepted once; a client must accept again only after a newer
// version is published, and that is checked when they next book (PRD B.2.3).

/**
 * True when the client must (re-)accept before booking: terms are published and the client has
 * accepted none, or an older version. With nothing published there is nothing to accept.
 */
export function termsAcceptanceRequired(acceptedVersion: number | null, currentVersion: number | null): boolean {
  if (currentVersion === null) {
    return false;
  }
  return acceptedVersion === null || acceptedVersion < currentVersion;
}

/** Per section (general terms, refund policy). Keeps a save well under the request size limit. */
export const TERMS_SECTION_MAX_LENGTH = 20_000;
