import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedException } from './permissions.guard';

const AUTH_POLICY_KEY = 'auth:policy';

/**
 * Global safety net: every route in an `admin/...` controller must declare @StaffOnly,
 * @StaffSignedIn or @PublicRoute. One that forgot is refused (and logged), so a missing
 * guard fails closed instead of exposing CRM data.
 */
@Injectable()
export class AdminRoutePolicyGuard implements CanActivate {
  private readonly logger = new Logger(AdminRoutePolicyGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }
    const controllerPath = this.reflector.get<string | string[] | undefined>(PATH_METADATA, context.getClass());
    const paths = Array.isArray(controllerPath) ? controllerPath : [controllerPath ?? ''];
    if (!paths.some((p) => p.replace(/^\/+/, '').startsWith('admin'))) {
      return true;
    }

    const policy = this.reflector.getAllAndOverride<string | undefined>(AUTH_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} has no @StaffOnly/@StaffSignedIn/@PublicRoute; refusing`,
      );
      throw new PermissionDeniedException();
    }
    return true;
  }
}
