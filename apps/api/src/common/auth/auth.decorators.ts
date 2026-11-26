import { ExecutionContext, SetMetadata, UseGuards, applyDecorators, createParamDecorator } from '@nestjs/common';
import type { Permission } from '@remedist/shared';
import { ClientAuthGuard } from './client-auth.guard';
import type { ClientRequest, CurrentClientAccount } from './current-client';
import type { CurrentStaff, StaffRequest } from './current-staff';
import { PermissionsGuard } from './permissions.guard';
import { StaffAuthGuard } from './staff-auth.guard';

export const AUTH_POLICY_KEY = 'auth:policy';
export const REQUIRED_PERMISSIONS_KEY = 'auth:permissions';

/**
 * How a route is protected. Every route under /admin or /portal must declare one that fits its
 * audience, or the global RoutePolicyGuard refuses it: a forgotten guard fails closed, not open.
 */
export type AuthPolicy = 'public' | 'staff-signed-in' | 'staff-permissions' | 'client-signed-in';

/**
 * Staff route that needs every listed permission. At least one is required, so the scoped
 * ask_remedist login (ai.ask only) is shut out of every other staff route by default.
 *   @StaffOnly(Permission.SCHEDULE_MANAGE)
 */
export function StaffOnly(first: Permission, ...rest: Permission[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(AUTH_POLICY_KEY, 'staff-permissions' satisfies AuthPolicy),
    SetMetadata(REQUIRED_PERMISSIONS_KEY, [first, ...rest]),
    UseGuards(StaffAuthGuard, PermissionsGuard),
  );
}

/** Any signed-in staff member, whatever their permissions. Only for their own account (me, logout-all). */
export function StaffSignedIn(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(AUTH_POLICY_KEY, 'staff-signed-in' satisfies AuthPolicy),
    UseGuards(StaffAuthGuard),
  );
}

/**
 * A signed-in client (patient portal). Use @CurrentClient() for the account, and check that any
 * record they ask for belongs to its contactId.
 */
export function ClientSignedIn(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(AUTH_POLICY_KEY, 'client-signed-in' satisfies AuthPolicy),
    UseGuards(ClientAuthGuard),
  );
}

/** No access token needed (login, refresh, logout, public pages). Say so explicitly. */
export function PublicRoute(): MethodDecorator & ClassDecorator {
  return SetMetadata(AUTH_POLICY_KEY, 'public' satisfies AuthPolicy);
}

/** The signed-in staff member. Only on routes behind @StaffOnly or @StaffSignedIn. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): CurrentStaff => {
  const staff = context.switchToHttp().getRequest<StaffRequest>().staff;
  if (!staff) {
    throw new Error('@CurrentUser() used on a route without @StaffOnly or @StaffSignedIn');
  }
  return staff;
});

/** The signed-in client account. Only on routes behind @ClientSignedIn. */
export const CurrentClient = createParamDecorator((_: unknown, context: ExecutionContext): CurrentClientAccount => {
  const client = context.switchToHttp().getRequest<ClientRequest>().client;
  if (!client) {
    throw new Error('@CurrentClient() used on a route without @ClientSignedIn');
  }
  return client;
});
