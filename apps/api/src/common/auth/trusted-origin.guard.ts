import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PermissionDeniedException } from './permissions.guard';
import { AppConfig } from '../../config/app-config';

/**
 * CSRF defence for the cookie-authenticated routes (refresh, logout), on top of SameSite=Strict:
 * a browser request must come from the web app's origin. Requests without an Origin header
 * (curl, server-side calls) carry no browser cookie risk and are allowed.
 */
@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (origin !== undefined && origin !== this.config.webUrl) {
      throw new PermissionDeniedException();
    }
    return true;
  }
}
