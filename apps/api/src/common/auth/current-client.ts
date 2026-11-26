import type { Request } from 'express';

/** The signed-in client (patient portal account), attached to the request by ClientAuthGuard. */
export interface CurrentClientAccount {
  /** auth.patient_accounts.id */
  id: string;
  /** The contact this account belongs to. Ownership checks compare against it. */
  contactId: string;
  email: string;
  /** The auth.sessions row this access token belongs to. */
  sessionId: string;
}

export type ClientRequest = Request & { client?: CurrentClientAccount };

/** Claims in a client access token. */
export interface ClientAccessClaims {
  /** auth.patient_accounts.id */
  sub: string;
  /** Session id. */
  sid: string;
  /** auth.patient_accounts.token_version when issued. */
  tv: number;
}
