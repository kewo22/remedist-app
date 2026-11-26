import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/app-config';
import { JWT_AUDIENCE_CLIENT } from '../../modules/client-auth/client-auth.constants';
import { ClientAuthRepository } from '../../modules/client-auth/client-auth.repository';
import { JWT_ISSUER } from './auth.constants';
import { SessionExpiredException } from './auth.exceptions';
import type { ClientAccessClaims, ClientRequest } from './current-client';

/**
 * Accepts a client access token from `Authorization: Bearer`, then re-checks the database in one
 * query: the session isn't revoked or expired and token_version matches. So logout,
 * sign-out-everywhere and a password reset take effect immediately, not after 15 minutes.
 */
@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly repository: ClientAuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClientRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new SessionExpiredException();
    }

    let claims: ClientAccessClaims;
    try {
      claims = await this.jwt.verifyAsync<ClientAccessClaims>(token, {
        secret: this.config.auth.clientJwtSecret,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_CLIENT,
        algorithms: ['HS256'],
      });
    } catch {
      throw new SessionExpiredException();
    }

    const access = await this.repository.findAccess(claims.sub, claims.sid);
    const valid =
      access !== undefined &&
      access.token_version === claims.tv &&
      access.session_revoked_at === null &&
      access.session_expires_at.getTime() > Date.now();
    if (!valid) {
      throw new SessionExpiredException();
    }

    request.client = { id: access.id, contactId: access.contact_id, email: access.email, sessionId: claims.sid };
    return true;
  }
}
