import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, Permission } from '@remedist/shared';
import { DomainException } from '../exceptions/domain.exception';
import type { StaffRequest } from './current-staff';

// Defined here rather than imported, to avoid a cycle with auth.decorators.ts.
const REQUIRED_PERMISSIONS_KEY = 'auth:permissions';

export class PermissionDeniedException extends DomainException {
  constructor() {
    super(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You don’t have access to this.');
  }
}

/**
 * Requires every permission listed by @StaffOnly. Runs after StaffAuthGuard. A route with no
 * permissions listed is denied: there is no "any staff" default.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const staff = context.switchToHttp().getRequest<StaffRequest>().staff;
    if (!staff || !required || required.length === 0) {
      throw new PermissionDeniedException();
    }
    if (!required.every((permission) => staff.permissions.has(permission))) {
      throw new PermissionDeniedException();
    }
    return true;
  }
}
