import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, type StaffProfile, type StaffSession } from '@remedist/shared';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import { ACCESS_TOKEN_TTL_SECONDS, BCRYPT_COST, JWT_ISSUER, LOGIN_LIMITS } from '../../common/auth/auth.constants';
import { InvalidCredentialsException, SessionExpiredException } from '../../common/auth/auth.exceptions';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentStaff, StaffAccessClaims } from '../../common/auth/current-staff';
import { LoginThrottleService } from '../../common/auth/login-throttle.service';
import { RefreshSessionsService, StartedSession } from '../../common/auth/refresh-sessions.service';
import { AppConfig } from '../../config/app-config';
import { DatabaseService } from '../../database/database.service';
import { JWT_AUDIENCE_STAFF, LOGIN_THROTTLE_PURPOSE, SESSION_TTL_SECONDS } from './staff-auth.constants';
import { MfaRequiredException } from './staff-auth.exceptions';
import { StaffAuthRepository } from './staff-auth.repository';

/** A session plus the raw refresh token, which only ever goes into the cookie. */
export interface IssuedStaffSession {
  session: StaffSession;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class StaffAuthService implements OnModuleInit {
  /** Compared against when the email is unknown, so both paths take the same bcrypt time. */
  private dummyHash = '';

  constructor(
    private readonly repository: StaffAuthRepository,
    private readonly sessions: RefreshSessionsService,
    private readonly throttle: LoginThrottleService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly audit: AuditLogRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(16).toString('hex'), BCRYPT_COST);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedStaffSession> {
    await this.throttle.assertAllowed(LOGIN_THROTTLE_PURPOSE, LOGIN_LIMITS, email, client.ipAddress);

    const login = await this.repository.findLoginByEmail(email);
    const passwordMatches = await compare(password, login?.password_hash ?? this.dummyHash);
    // A disabled login gets the same answer as a wrong password: nothing to learn from probing.
    if (!login || !passwordMatches || !login.is_active) {
      await this.throttle.recordFailure(LOGIN_THROTTLE_PURPOSE, email, client.ipAddress);
      throw new InvalidCredentialsException();
    }
    // super_admin requires MFA, which isn't built yet, so it can't sign in at all.
    if (login.roles.includes(Role.SUPER_ADMIN)) {
      throw new MfaRequiredException();
    }

    const started = await this.sessions.start('staff', login.id, SESSION_TTL_SECONDS, client);
    await this.repository.recordLogin(login.id);
    return this.issue(started);
  }

  /** Rotates the refresh token. The login must still be active and not super_admin. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedStaffSession> {
    const started = await this.sessions.rotate('staff', refreshToken, client, async (staffUserId) => {
      const profile = await this.repository.findProfile(staffUserId);
      return profile !== undefined && profile.is_active && !profile.roles.includes(Role.SUPER_ADMIN);
    });
    return this.issue(started);
  }

  /** Ends the session behind this refresh token, if any. Always succeeds. */
  logout(refreshToken: string | undefined): Promise<void> {
    return this.sessions.end('staff', refreshToken);
  }

  /** Ends every session for this login, on every device. */
  async logoutEverywhere(staff: CurrentStaff, client: ClientInfo): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.repository.bumpTokenVersion(staff.id, tx);
      const revoked = await this.sessions.endAll('staff', staff.id, tx);
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

  private async issue(started: StartedSession): Promise<IssuedStaffSession> {
    const profile = await this.repository.findProfile(started.ownerId);
    if (!profile) {
      throw new SessionExpiredException();
    }
    const claims: StaffAccessClaims = { sub: profile.id, sid: started.sessionId, tv: profile.token_version };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.auth.staffJwtSecret,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_STAFF,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
    });
    return {
      session: {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
        staff: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          roles: [...profile.roles].sort(),
          permissions: [...profile.permissions].sort(),
        },
      },
      refreshToken: started.refreshToken,
      refreshExpiresAt: started.expiresAt,
    };
  }
}
