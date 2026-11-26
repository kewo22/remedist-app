import type { Permission, Role } from '@remedist/shared';
import type { Request } from 'express';

/** The signed-in staff member, attached to the request by StaffAuthGuard. */
export interface CurrentStaff {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  permissions: ReadonlySet<Permission>;
  /** The auth.sessions row this access token belongs to. */
  sessionId: string;
}

export type StaffRequest = Request & { staff?: CurrentStaff };

/** Claims in a staff access token. */
export interface StaffAccessClaims {
  sub: string;
  /** Session id. */
  sid: string;
  /** auth.staff_users.token_version when issued. */
  tv: number;
}
