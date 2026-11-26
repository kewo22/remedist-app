// Staff (CRM) login. The access token goes in `Authorization: Bearer` on every staff request.
// The refresh token is an httpOnly cookie the browser sends to the auth routes by itself, so
// those calls need `credentials: 'include'`.

import type { Permission, Role } from '../enums/role';

export const STAFF_AUTH_ROUTES = {
  /** POST StaffLoginRequest → StaffSession (sets the refresh cookie). */
  login: '/admin/auth/login',
  /** POST, no body → StaffSession. Rotates the refresh cookie. On REFRESH_CONFLICT, retry once. */
  refresh: '/admin/auth/refresh',
  /** POST, no body → null. Ends this session and clears the cookie. */
  logout: '/admin/auth/logout',
  /** POST, no body (Bearer) → null. Ends every session for this login. */
  logoutAll: '/admin/auth/logout-all',
  /** GET (Bearer) → StaffProfile. */
  me: '/admin/auth/me',
} as const;

export interface StaffLoginRequest {
  email: string;
  password: string;
}

export interface StaffProfile {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  /** What the CRM may show. The API enforces the same list on every route. */
  permissions: Permission[];
}

export interface StaffSession {
  accessToken: string;
  /** ISO 8601. Refresh shortly before this. */
  accessTokenExpiresAt: string;
  staff: StaffProfile;
}
