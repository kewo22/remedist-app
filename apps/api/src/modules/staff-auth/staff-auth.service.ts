import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, type StaffProfile, type StaffSession } from '@remedist/shared';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { CurrentStaff, StaffAccessClaims } from '../../common/auth/current-staff';
import { DatabaseService } from '../../database/database.service';
import { LoginThrottleService } from './login-throttle.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  BCRYPT_COST,
  JWT_AUDIENCE_STAFF,
  JWT_ISSUER,
  MAX_USER_AGENT_LENGTH,
  REFRESH_REUSE_GRACE_SECONDS,
  REFRESH_TOKEN_BYTES,
  SESSION_TTL_SECONDS,
} from './staff-auth.constants';
import {
  InvalidCredentialsException,
  MfaRequiredException,
  RefreshConflictException,
  SessionExpiredException,
} from './staff-auth.exceptions';
import { StaffAuthRepository } from './staff-auth.repository';

export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
  requestId?: string;
}

/** A session plus the raw refresh token, which only ever goes into the cookie. */
export interface IssuedSession {
  session: StaffSession;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

@Injectable()
export class StaffAuthService implements OnModuleInit {
  /** Compared against when the email is unknown, so both paths take the same bcrypt time. */
  private dummyHash = '';

  constructor(
    private readonly repository: StaffAuthRepository,
    private readonly throttle: LoginThrottleService,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    private readonly audit: AuditLogRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(16).toString('hex'), BCRYPT_COST);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedSession> {
    await this.throttle.assertAllowed(email, client.ipAddress);

    const login = await this.repository.findLoginByEmail(email);
    const passwordMatches = await compare(password, login?.password_hash ?? this.dummyHash);
    // A disabled login gets the same answer as a wrong password: nothing to learn from probing.
    if (!login || !passwordMatches || !login.is_active) {
      await this.throttle.recordFailure(email, client.ipAddress);
      throw new InvalidCredentialsException();
    }
    // super_admin requires MFA, which isn't built yet, so it can't sign in at all.
    if (login.roles.includes(Role.SUPER_ADMIN)) {
      throw new MfaRequiredException();
    }

    const refreshToken = newRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    const sessionId = await this.repository.createSession({
      staffUserId: login.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: client.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      ipAddress: client.ipAddress,
    });
    await this.repository.recordLogin(login.id);

    return { session: await this.buildSession(login.id, sessionId, login.token_version), refreshToken, refreshExpiresAt };
  }

  /**
   * Swaps a refresh token for a new one (rotation) and a new access token. The new session keeps
   * the original absolute expiry. Presenting an already-replaced token is treated as theft and
   * revokes the whole chain, unless it was replaced moments ago (two tabs racing).
   */
  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
    const current = await this.repository.findSessionByTokenHash(hashToken(refreshToken));
    if (!current) {
      throw new SessionExpiredException();
    }

    if (current.replaced_by) {
      const replacedAgo = current.revoked_at ? (Date.now() - current.revoked_at.getTime()) / 1000 : Infinity;
      if (replacedAgo <= REFRESH_REUSE_GRACE_SECONDS) {
        throw new RefreshConflictException();
      }
      await this.repository.revokeChainFrom(current.id);
      throw new SessionExpiredException();
    }
    if (current.revoked_at || current.expires_at.getTime() <= Date.now()) {
      throw new SessionExpiredException();
    }

    const profile = await this.repository.findProfile(current.staff_user_id);
    if (!profile || !profile.is_active || profile.roles.includes(Role.SUPER_ADMIN)) {
      await this.repository.revokeSession(current.id);
      throw new SessionExpiredException();
    }

    const nextToken = newRefreshToken();
    const nextSessionId = await this.db.transaction(async (tx) => {
      const id = await this.repository.createSession(
        {
          staffUserId: current.staff_user_id,
          refreshTokenHash: hashToken(nextToken),
          expiresAt: current.expires_at,
          userAgent: client.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
          ipAddress: client.ipAddress,
        },
        tx,
      );
      if (!(await this.repository.markRotated(current.id, id, tx))) {
        // Another request rotated it between our read and this write.
        throw new RefreshConflictException();
      }
      return id;
    });

    return {
      session: await this.buildSession(profile.id, nextSessionId, profile.token_version),
      refreshToken: nextToken,
      refreshExpiresAt: current.expires_at,
    };
  }

  /** Ends the session behind this refresh token, if any. Always succeeds. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const current = await this.repository.findSessionByTokenHash(hashToken(refreshToken));
    if (current) {
      await this.repository.revokeSession(current.id);
    }
  }

  /** Ends every session for this login, on every device. */
  async logoutEverywhere(staff: CurrentStaff, client: ClientInfo): Promise<void> {
    await this.db.transaction(async (tx) => {
      const revoked = await this.repository.revokeAllSessions(staff.id, tx);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staff.id,
          actorLabel: staff.name,
          action: 'staff.signed_out_everywhere',
          entityType: 'staff_user',
          entityId: staff.id,
          after: { sessionsRevoked: revoked },
          requestId: client.requestId,
          ipAddress: client.ipAddress,
        },
        tx,
      );
    });
  }

  toProfile(staff: CurrentStaff): StaffProfile {
    return {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      roles: [...staff.roles].sort(),
      permissions: [...staff.permissions].sort(),
    };
  }

  private async buildSession(staffUserId: string, sessionId: string, tokenVersion: number): Promise<StaffSession> {
    const profile = await this.repository.findProfile(staffUserId);
    if (!profile) {
      throw new SessionExpiredException();
    }
    const claims: StaffAccessClaims = { sub: staffUserId, sid: sessionId, tv: tokenVersion };
    const accessToken = await this.jwt.signAsync(claims, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_STAFF,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
    });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      staff: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        roles: [...profile.roles].sort(),
        permissions: [...profile.permissions].sort(),
      },
    };
  }
}
