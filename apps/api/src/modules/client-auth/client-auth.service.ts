import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  ClientProfile,
  ClientRegisterResponse,
  ClientSession,
  ForgotPasswordResponse,
  PasswordResetChannel,
} from '@remedist/shared';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import { ACCESS_TOKEN_TTL_SECONDS, BCRYPT_COST, JWT_ISSUER, LOGIN_LIMITS } from '../../common/auth/auth.constants';
import { failDelay, sixDigitCode } from '../../common/auth/auth-tokens';
import {
  InvalidCodeException,
  InvalidCredentialsException,
  SessionExpiredException,
} from '../../common/auth/auth.exceptions';
import type { ClientInfo } from '../../common/auth/client-info';
import type { ClientAccessClaims, CurrentClientAccount } from '../../common/auth/current-client';
import { LoginThrottleService } from '../../common/auth/login-throttle.service';
import { RefreshSessionsService, StartedSession } from '../../common/auth/refresh-sessions.service';
import { AppConfig } from '../../config/app-config';
import { DatabaseService } from '../../database/database.service';
import { EmailMessage, EmailProvider, maskEmail } from '../../integrations/email/email.provider';
import {
  GoogleIdentity,
  GoogleIdentityVerifier,
  GoogleSignInUnavailableError,
  GoogleTokenRejectedError,
} from '../../integrations/google/google-identity.verifier';
import { ContactsRepository } from '../contacts/contacts.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { EMAIL_VERIFICATION_CODE_TTL_MINUTES } from '../otp/otp.constants';
import { OtpService } from '../otp/otp.service';
import type { OtpDeliveryStatus, OtpIdentifier } from '../otp/otp.types';
import {
  EMAIL_VERIFY_LIMITS,
  EMAIL_VERIFY_THROTTLE_PURPOSE,
  JWT_AUDIENCE_CLIENT,
  LOGIN_THROTTLE_PURPOSE,
  SESSION_TTL_SECONDS,
} from './client-auth.constants';
import { accountExistsEmail, passwordResetCodeEmail, verificationCodeEmail } from './client-auth.emails';
import {
  GoogleSignInFailedException,
  GoogleSignInUnavailableException,
  PhoneChannelUnavailableException,
} from './client-auth.exceptions';
import { ClientAccountRow, ClientAuthRepository } from './client-auth.repository';

/** A session plus the raw refresh token, which only ever goes into the cookie. */
export interface IssuedClientSession {
  session: ClientSession;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const RESET_DAILY_CAP_MESSAGE = 'Password reset codes are temporarily unavailable — please try again later.';
const SIGN_UP_DAILY_CAP_MESSAGE = 'Sign-up codes are temporarily unavailable — please try again later.';

function emailIdentifier(email: string): OtpIdentifier {
  return { kind: 'email', value: email };
}

/**
 * Client (patient portal) sign-up, email verification, password and Google sign-in, and password
 * reset. Ported from the old /api/auth routes, keeping their outcomes: no answer ever reveals
 * whether an email has an account.
 */
@Injectable()
export class ClientAuthService implements OnModuleInit {
  private readonly logger = new Logger(ClientAuthService.name);
  /** Compared against when the email is unknown, so both paths take the same bcrypt time. */
  private dummyHash = '';

  constructor(
    private readonly repository: ClientAuthRepository,
    private readonly contacts: ContactsRepository,
    private readonly sessions: RefreshSessionsService,
    private readonly throttle: LoginThrottleService,
    private readonly otp: OtpService,
    private readonly email: EmailProvider,
    private readonly google: GoogleIdentityVerifier,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogRepository,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(16).toString('hex'), BCRYPT_COST);
  }

  // ── Sign-up and verification ─────────────────────────────────────────────────────────────

  /**
   * Creates the account (unverified) and emails a 6-digit code. The answer is the same whether the
   * email is new or taken: an existing owner gets an "you already have an account" email instead.
   * The send limits apply to every address, so a 429 isn't a hint either. A retry before
   * verifying replaces the password and sends a fresh code.
   */
  async register(name: string, email: string, password: string, client: ClientInfo): Promise<ClientRegisterResponse> {
    const identifier = emailIdentifier(email);
    const existing = await this.repository.findByEmail(email);
    await this.otp.assertCanSend(identifier, client.ipAddress, 'email_verification', SIGN_UP_DAILY_CAP_MESSAGE);

    if (existing?.email_verified_at) {
      // Recorded like a real send, so this address is rate-limited exactly like a new one.
      await this.otp.recordIssued({
        identifier,
        ipAddress: client.ipAddress,
        purpose: 'email_verification',
        channel: 'email',
        code: sixDigitCode(),
        ttlMinutes: EMAIL_VERIFICATION_CODE_TTL_MINUTES,
        deliveryStatus: 'skipped',
      });
      await this.sendQuietly(accountExistsEmail(email, existing.name));
      return { email };
    }

    const passwordHash = await hash(password, BCRYPT_COST);
    const created = await this.db.transaction(async (tx) => {
      if (existing) {
        await this.repository.replaceUnverifiedPassword(existing.id, passwordHash, tx);
        await this.contacts.renameUnlessLocked(existing.contact_id, name, tx);
        return true;
      }
      const contact = await this.contacts.findOrCreateByEmail({ name, email, source: 'website' }, tx);
      const accountId = await this.repository.createWithPassword({ contactId: contact.id, email, passwordHash }, tx);
      if (!accountId) {
        return false; // A concurrent sign-up for this email won.
      }
      if (contact.created) {
        await this.notifications.notify(
          { section: 'pipeline', type: 'new_lead', severity: 'info', message: `New lead: ${name}`, entityType: 'contact', entityId: contact.id },
          tx,
        );
      }
      await this.notifications.notify(
        {
          section: 'accounts',
          type: 'new_signup',
          severity: 'info',
          message: `New client signup: ${name}`,
          entityType: 'patient_account',
          entityId: accountId,
        },
        tx,
      );
      return true;
    });
    if (!created) {
      return { email };
    }

    const code = sixDigitCode();
    const status = await this.sendQuietly(verificationCodeEmail(email, name, code, EMAIL_VERIFICATION_CODE_TTL_MINUTES));
    await this.otp.recordIssued({
      identifier,
      ipAddress: client.ipAddress,
      purpose: 'email_verification',
      channel: 'email',
      code,
      ttlMinutes: EMAIL_VERIFICATION_CODE_TTL_MINUTES,
      deliveryStatus: status,
    });
    return { email, devCode: this.devCode(status, code) };
  }

  /** Checks the emailed code, marks the email verified and signs the client in. */
  async verifyEmail(email: string, code: string, client: ClientInfo): Promise<IssuedClientSession> {
    await this.throttle.assertAllowed(EMAIL_VERIFY_THROTTLE_PURPOSE, EMAIL_VERIFY_LIMITS, email, client.ipAddress);

    const account = await this.repository.findByEmail(email);
    const result =
      account && !account.email_verified_at
        ? await this.otp.verify(emailIdentifier(email), 'email_verification', code)
        : { verified: false };
    if (!account || !result.verified) {
      await this.throttle.recordFailure(EMAIL_VERIFY_THROTTLE_PURPOSE, email, client.ipAddress);
      throw new InvalidCodeException();
    }

    await this.repository.markEmailVerified(account.id);
    return this.signIn(account.id, client);
  }

  // ── Sign-in ──────────────────────────────────────────────────────────────────────────────

  /** Email and password. Unknown email, wrong password, Google-only and unverified all get the same answer. */
  async login(email: string, password: string, client: ClientInfo): Promise<IssuedClientSession> {
    await this.throttle.assertAllowed(LOGIN_THROTTLE_PURPOSE, LOGIN_LIMITS, email, client.ipAddress);

    const account = await this.repository.findByEmail(email);
    const passwordMatches = await compare(password, account?.password_hash ?? this.dummyHash);
    if (!account?.password_hash || !passwordMatches || !account.email_verified_at) {
      await this.throttle.recordFailure(LOGIN_THROTTLE_PURPOSE, email, client.ipAddress);
      throw new InvalidCredentialsException();
    }
    return this.signIn(account.id, client);
  }

  /**
   * Google sign-in. Finds the account by Google id, else links Google to the account with the same
   * email, else creates one. Google must have verified the email. Linking to an account whose
   * email was never verified removes its password, because whoever set it never proved they own
   * the address (someone could have registered first with another person's email).
   */
  async signInWithGoogle(idToken: string, client: ClientInfo): Promise<IssuedClientSession> {
    const identity = await this.verifyGoogleToken(idToken);
    const email = identity.email.trim().toLowerCase();

    const accountId = await this.db.transaction(async (tx) => {
      const byGoogleId = await this.repository.findByGoogleId(identity.googleId, tx);
      if (byGoogleId) {
        return byGoogleId.id;
      }

      const byEmail = await this.repository.findByEmail(email, tx);
      if (byEmail) {
        const removePassword = byEmail.email_verified_at === null && byEmail.password_hash !== null;
        await this.repository.linkGoogle(byEmail.id, identity.googleId, removePassword, tx);
        if (byEmail.email_verified_at === null) {
          // Nothing an unproven sign-up typed is trusted, including the name.
          await this.contacts.renameUnlessLocked(byEmail.contact_id, identity.name, tx);
        }
        await this.audit.record(
          {
            actorType: 'patient',
            actorId: byEmail.id,
            actorLabel: byEmail.name,
            action: 'patient_account.google_linked',
            entityType: 'patient_account',
            entityId: byEmail.id,
            after: { passwordRemoved: removePassword },
            requestId: client.requestId,
            ipAddress: client.ipAddress,
          },
          tx,
        );
        return byEmail.id;
      }

      const contact = await this.contacts.findOrCreateByEmail({ name: identity.name, email, source: 'website' }, tx);
      const createdId = await this.repository.createWithGoogle(
        { contactId: contact.id, email, googleId: identity.googleId },
        tx,
      );
      if (!createdId) {
        // A concurrent sign-in created it first; its row is committed and visible now.
        const raced =
          (await this.repository.findByGoogleId(identity.googleId, tx)) ?? (await this.repository.findByEmail(email, tx));
        if (!raced) {
          throw new GoogleSignInFailedException();
        }
        return raced.id;
      }
      if (contact.created) {
        await this.notifications.notify(
          {
            section: 'pipeline',
            type: 'new_lead',
            severity: 'info',
            message: `New lead: ${identity.name}`,
            entityType: 'contact',
            entityId: contact.id,
          },
          tx,
        );
      }
      await this.notifications.notify(
        {
          section: 'accounts',
          type: 'new_signup',
          severity: 'info',
          message: `New client signup: ${identity.name}`,
          entityType: 'patient_account',
          entityId: createdId,
        },
        tx,
      );
      return createdId;
    });

    return this.signIn(accountId, client);
  }

  // ── Password reset ───────────────────────────────────────────────────────────────────────

  /**
   * Sends a reset code. The same answer, after the same checks, whether or not the email has an
   * account with a password: the code is only actually sent when it does. Full OTP protection:
   * blocklist, daily cap, windows, cooldown, and Turnstile from the second request.
   */
  async forgotPassword(
    email: string,
    channel: PasswordResetChannel,
    turnstileToken: string | undefined,
    client: ClientInfo,
  ): Promise<ForgotPasswordResponse> {
    if (channel === 'phone') {
      throw new PhoneChannelUnavailableException();
    }
    const identifier = emailIdentifier(email);
    const account = await this.repository.findByEmail(email);
    const eligible = account?.password_hash != null;

    await this.otp.assertCanSend(identifier, client.ipAddress, 'password_reset', RESET_DAILY_CAP_MESSAGE);
    await this.otp.assertChallengePassed(identifier, client.ipAddress, 'password_reset', turnstileToken);

    const code = sixDigitCode();
    const ttlMinutes = this.config.otp.codeTtlMinutes;
    let status: OtpDeliveryStatus = 'skipped';
    if (account && eligible) {
      status = await this.sendQuietly(passwordResetCodeEmail(email, account.name, code, ttlMinutes));
    } else {
      await failDelay();
    }
    await this.otp.recordIssued({
      identifier,
      ipAddress: client.ipAddress,
      purpose: 'password_reset',
      channel: 'email',
      code,
      ttlMinutes,
      deliveryStatus: status,
    });

    return {
      channel,
      nextResendWaitSeconds: await this.otp.nextCooldownSeconds(identifier),
      devCode: eligible ? this.devCode(status, code) : undefined,
    };
  }

  /**
   * Checks the reset code and sets the new password in one step. Signs out every device (a reset
   * often follows a compromise) and signs this one in.
   */
  async resetPassword(
    email: string,
    channel: PasswordResetChannel,
    code: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<IssuedClientSession> {
    if (channel === 'phone') {
      throw new PhoneChannelUnavailableException();
    }
    const account = await this.repository.findByEmail(email);
    const result = account?.password_hash
      ? await this.otp.verify(emailIdentifier(email), 'password_reset', code)
      : { verified: false };
    if (!account || !result.verified) {
      await failDelay();
      throw new InvalidCodeException();
    }

    const passwordHash = await hash(newPassword, BCRYPT_COST);
    await this.db.transaction(async (tx) => {
      await this.repository.resetPassword(account.id, passwordHash, tx);
      const revoked = await this.sessions.endAll('patient', account.id, tx);
      await this.audit.record(
        {
          actorType: 'patient',
          actorId: account.id,
          actorLabel: account.name,
          action: 'patient_account.password_reset',
          entityType: 'patient_account',
          entityId: account.id,
          after: { sessionsRevoked: revoked },
          requestId: client.requestId,
          ipAddress: client.ipAddress,
        },
        tx,
      );
    });
    return this.signIn(account.id, client);
  }

  // ── Session ──────────────────────────────────────────────────────────────────────────────

  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedClientSession> {
    const started = await this.sessions.rotate(
      'patient',
      refreshToken,
      client,
      async (accountId) => (await this.repository.findById(accountId)) !== undefined,
    );
    return this.issue(started);
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return this.sessions.end('patient', refreshToken);
  }

  async logoutEverywhere(current: CurrentClientAccount, client: ClientInfo): Promise<void> {
    const account = await this.repository.findById(current.id);
    await this.db.transaction(async (tx) => {
      await this.repository.bumpTokenVersion(current.id, tx);
      const revoked = await this.sessions.endAll('patient', current.id, tx);
      await this.audit.record(
        {
          actorType: 'patient',
          actorId: current.id,
          actorLabel: account?.name ?? current.email,
          action: 'patient_account.signed_out_everywhere',
          entityType: 'patient_account',
          entityId: current.id,
          after: { sessionsRevoked: revoked },
          requestId: client.requestId,
          ipAddress: client.ipAddress,
        },
        tx,
      );
    });
  }

  async profile(current: CurrentClientAccount): Promise<ClientProfile> {
    const account = await this.repository.findById(current.id);
    if (!account) {
      throw new SessionExpiredException();
    }
    return this.toProfile(account);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────

  private async signIn(accountId: string, client: ClientInfo): Promise<IssuedClientSession> {
    const started = await this.sessions.start('patient', accountId, SESSION_TTL_SECONDS, client);
    await this.repository.recordLogin(accountId);
    return this.issue(started);
  }

  private async issue(started: StartedSession): Promise<IssuedClientSession> {
    const account = await this.repository.findById(started.ownerId);
    if (!account) {
      throw new SessionExpiredException();
    }
    const claims: ClientAccessClaims = { sub: account.id, sid: started.sessionId, tv: account.token_version };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.auth.clientJwtSecret,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_CLIENT,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
    });
    return {
      session: {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
        client: this.toProfile(account),
      },
      refreshToken: started.refreshToken,
      refreshExpiresAt: started.expiresAt,
    };
  }

  private toProfile(account: ClientAccountRow): ClientProfile {
    return {
      id: account.id,
      contactId: account.contact_id,
      name: account.name,
      email: account.email,
      emailVerified: account.email_verified_at !== null,
      authProvider: account.auth_provider,
      hasPassword: account.password_hash !== null,
    };
  }

  private async verifyGoogleToken(idToken: string): Promise<GoogleIdentity> {
    let identity: GoogleIdentity;
    try {
      identity = await this.google.verify(idToken);
    } catch (error) {
      if (error instanceof GoogleSignInUnavailableError) {
        throw new GoogleSignInUnavailableException();
      }
      if (error instanceof GoogleTokenRejectedError) {
        throw new GoogleSignInFailedException(error);
      }
      throw error;
    }
    // Linking by email is only safe when Google has verified the person owns it.
    if (!identity.emailVerified) {
      throw new GoogleSignInFailedException();
    }
    return identity;
  }

  /**
   * Sends an email without letting a provider failure change the response: that would tell the
   * caller whether the address has an account. Failures are logged (and land in the ledger as
   * 'failed') for staff to notice.
   */
  private async sendQuietly(message: EmailMessage): Promise<OtpDeliveryStatus> {
    try {
      return (await this.email.send(message)).status;
    } catch (error) {
      this.logger.error(
        `Email "${message.subject}" to ${maskEmail(message.to)} failed`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    }
  }

  /** The code itself, only outside production while email is in demo mode, so the flow is testable. */
  private devCode(status: OtpDeliveryStatus, code: string): string | undefined {
    return status === 'skipped' && this.email.isDemo && !this.config.isProduction ? code : undefined;
  }
}
