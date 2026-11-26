import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AUTH_POLICY_KEY, type AuthPolicy } from './auth.decorators';
import { PermissionDeniedException } from './permissions.guard';

/** Which policies each audience prefix accepts. */
const ALLOWED_POLICIES: Record<'admin' | 'portal', readonly AuthPolicy[]> = {
  admin: ['public', 'staff-signed-in', 'staff-permissions'],
  portal: ['public', 'client-signed-in'],
};

/**
 * Global safety net. Every route in an `admin/...` controller must declare @StaffOnly,
 * @StaffSignedIn or @PublicRoute, and every route in a `portal/...` controller @ClientSignedIn or
 * @PublicRoute. A route that forgot, or uses the other audience's guard, is refused (and logged),
 * so a missing guard fails closed instead of exposing data.
 */
@Injectable()
export class RoutePolicyGuard implements CanActivate {
  private readonly logger = new Logger(RoutePolicyGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }
    const audience = this.audienceOf(context);
    if (!audience) {
      return true;
    }

    const policy = this.reflector.getAllAndOverride<AuthPolicy | undefined>(AUTH_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy || !ALLOWED_POLICIES[audience].includes(policy)) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} under /${audience} has ` +
          `${policy ? `the wrong auth policy (${policy})` : 'no auth policy'}; refusing`,
      );
      throw new PermissionDeniedException();
    }
    return true;
  }

  private audienceOf(context: ExecutionContext): 'admin' | 'portal' | undefined {
    const controllerPath = this.reflector.get<string | string[] | undefined>(PATH_METADATA, context.getClass());
    const paths = (Array.isArray(controllerPath) ? controllerPath : [controllerPath ?? '']).map((p) =>
      p.replace(/^\/+/, ''),
    );
    for (const audience of ['admin', 'portal'] as const) {
      if (paths.some((p) => p === audience || p.startsWith(`${audience}/`))) {
        return audience;
      }
    }
    return undefined;
  }
}
