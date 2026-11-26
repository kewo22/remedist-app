import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_AUDIENCE_STAFF, JWT_ISSUER } from '../../modules/staff-auth/staff-auth.constants';
import { SessionExpiredException } from '../../modules/staff-auth/staff-auth.exceptions';
import { StaffAuthRepository } from '../../modules/staff-auth/staff-auth.repository';
import type { StaffAccessClaims, StaffRequest } from './current-staff';

/**
 * Accepts a staff access token from `Authorization: Bearer`, then re-checks the database in one
 * query: the session isn't revoked or expired, the login is active, and token_version matches.
 * So logout, sign-out-everywhere and disabling a login take effect immediately, not after the
 * token's 15 minutes. Permissions are read fresh, so a role change applies on the next request.
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly repository: StaffAuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new SessionExpiredException();
    }

    let claims: StaffAccessClaims;
    try {
      claims = await this.jwt.verifyAsync<StaffAccessClaims>(token, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_STAFF,
        algorithms: ['HS256'],
      });
    } catch {
      throw new SessionExpiredException();
    }

    const access = await this.repository.findAccess(claims.sub, claims.sid);
    const valid =
      access !== undefined &&
      access.is_active &&
      access.token_version === claims.tv &&
      access.session_revoked_at === null &&
      access.session_expires_at.getTime() > Date.now();
    if (!valid) {
      throw new SessionExpiredException();
    }

    request.staff = {
      id: access.id,
      name: access.name,
      email: access.email,
      roles: access.roles,
      permissions: new Set(access.permissions),
      sessionId: claims.sid,
    };
    return true;
  }
}
