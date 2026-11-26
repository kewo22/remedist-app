import { Injectable, Logger } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { BCRYPT_COST } from '../../common/auth/auth.constants';
import { TooManyAttemptsException } from '../../common/auth/auth.exceptions';
import { AppConfig } from '../../config/app-config';
import { TurnstileVerifier } from '../../integrations/turnstile/turnstile.verifier';
import { OtpCapAlertService } from './otp-cap-alert.service';
import {
  COOLDOWN_STEPS_SECONDS,
  IDENTIFIER_15M_MAX,
  IDENTIFIER_24H_MAX,
  IP_15M_MAX,
  IP_24H_MAX,
  MAX_VERIFY_ATTEMPTS,
} from './otp.constants';
import { ChallengeRequiredException, OtpDailyCapReachedException } from './otp.exceptions';
import { OtpRepository, WindowStats } from './otp.repository';
import {
  OtpChannel,
  OtpDeliveryStatus,
  OtpIdentifier,
  OtpPurpose,
  OtpVerifyResult,
  maskIdentifier,
} from './otp.types';

const FIFTEEN_MINUTES = 15 * 60;
const ONE_DAY = 24 * 60 * 60;

/** otp_requests.ip_address is required; a request with no IP (shouldn't happen behind Express) counts here. */
const UNKNOWN_IP = '0.0.0.0';

function secondsUntilClear(stats: WindowStats, windowSeconds: number): number {
  const elapsed = stats.oldest ? (Date.now() - stats.oldest.getTime()) / 1000 : 0;
  return Math.max(1, Math.ceil(windowSeconds - elapsed));
}

/** Wait required before the nth send to one identifier in 24 hours. */
function cooldownForNthSend(n: number): number {
  return COOLDOWN_STEPS_SECONDS[Math.min(n, COOLDOWN_STEPS_SECONDS.length) - 1] ?? 0;
}

export interface IssueCodeOptions {
  identifier: OtpIdentifier;
  ipAddress: string | null;
  purpose: OtpPurpose;
  channel: OtpChannel;
  code: string;
  ttlMinutes: number;
  deliveryStatus: OtpDeliveryStatus;
}

/**
 * Abuse protection for one-time codes, ported from the old otpRateLimit.service. Before any send,
 * in this order: the blocklist, the clinic-wide daily cap, the per-identifier and per-IP rolling
 * windows, then the progressive cooldown. Turnstile is an extra gate from the second send in 15
 * minutes, on top of those, not instead of them.
 *
 * Callers never learn (or tell the client) which limit was hit: that's only logged.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly repository: OtpRepository,
    private readonly turnstile: TurnstileVerifier,
    private readonly capAlert: OtpCapAlertService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Throws if a code may not be sent now: TooManyAttemptsException (429, with a wait when there is
   * one) or OtpDailyCapReachedException (503, with `dailyCapMessage`).
   */
  async assertCanSend(
    identifier: OtpIdentifier,
    ipAddress: string | null,
    purpose: OtpPurpose,
    dailyCapMessage?: string,
  ): Promise<void> {
    const ip = ipAddress ?? UNKNOWN_IP;
    const blocked = (reason: string, waitSeconds?: number): TooManyAttemptsException => {
      this.logEvent('send_blocked', identifier, purpose, reason);
      return new TooManyAttemptsException(waitSeconds);
    };

    if (await this.repository.isBlocked(identifier, ip)) {
      throw blocked('blocklisted');
    }

    const cap = this.config.otp.dailySendCap;
    const sentToday = await this.repository.countToday();
    if (sentToday >= cap) {
      this.logEvent('send_blocked', identifier, purpose, 'daily_cap');
      await this.capAlert.maybeAlert(sentToday, cap);
      throw new OtpDailyCapReachedException(dailyCapMessage);
    }

    const [id15, id24, ip15, ip24] = await Promise.all([
      this.repository.identifierWindow(identifier, FIFTEEN_MINUTES),
      this.repository.identifierWindow(identifier, ONE_DAY),
      this.repository.ipWindow(ip, FIFTEEN_MINUTES),
      this.repository.ipWindow(ip, ONE_DAY),
    ]);
    if (id15.count >= IDENTIFIER_15M_MAX) {
      throw blocked('identifier_15m', secondsUntilClear(id15, FIFTEEN_MINUTES));
    }
    if (id24.count >= IDENTIFIER_24H_MAX) {
      throw blocked('identifier_24h', secondsUntilClear(id24, ONE_DAY));
    }
    if (ip15.count >= IP_15M_MAX) {
      throw blocked('ip_15m', secondsUntilClear(ip15, FIFTEEN_MINUTES));
    }
    if (ip24.count >= IP_24H_MAX) {
      throw blocked('ip_24h', secondsUntilClear(ip24, ONE_DAY));
    }

    // Progressive cooldown since the last send to this identifier.
    if (id24.newest) {
      const cooldown = cooldownForNthSend(id24.count + 1);
      const remaining = Math.ceil(cooldown - (Date.now() - id24.newest.getTime()) / 1000);
      if (remaining > 0) {
        throw blocked('cooldown', remaining);
      }
    }
  }

  /**
   * From the second send in 15 minutes (per identifier or IP), a passed Turnstile token is required.
   * Throws ChallengeRequiredException when it's needed and missing or failed.
   */
  async assertChallengePassed(
    identifier: OtpIdentifier,
    ipAddress: string | null,
    purpose: OtpPurpose,
    turnstileToken: string | undefined,
  ): Promise<void> {
    const ip = ipAddress ?? UNKNOWN_IP;
    const [id15, ip15] = await Promise.all([
      this.repository.identifierWindow(identifier, FIFTEEN_MINUTES),
      this.repository.ipWindow(ip, FIFTEEN_MINUTES),
    ]);
    if (id15.count === 0 && ip15.count === 0) {
      return;
    }
    if (!(await this.turnstile.verify(turnstileToken, ipAddress))) {
      this.logEvent('send_blocked', identifier, purpose, 'challenge_failed');
      throw new ChallengeRequiredException();
    }
  }

  /**
   * Records an issued code (hashed). The row is also the send ledger the limits count, so record
   * failed and skipped sends too. Returns when the code expires.
   */
  async recordIssued(options: IssueCodeOptions): Promise<Date> {
    const { expiresAt } = await this.repository.create({
      identifier: options.identifier,
      ipAddress: options.ipAddress ?? UNKNOWN_IP,
      purpose: options.purpose,
      channel: options.channel,
      codeHash: await hash(options.code, BCRYPT_COST),
      ttlMinutes: options.ttlMinutes,
      deliveryStatus: options.deliveryStatus,
    });
    this.logEvent('send_allowed', options.identifier, options.purpose, `${options.channel}, ${options.deliveryStatus}`);
    return expiresAt;
  }

  /** Seconds the client must wait before the next send, so the page can count down straight away. */
  async nextCooldownSeconds(identifier: OtpIdentifier): Promise<number> {
    const id24 = await this.repository.identifierWindow(identifier, ONE_DAY);
    return cooldownForNthSend(id24.count + 1);
  }

  /**
   * Checks a code against every still-pending, unexpired code for this identifier and purpose (so a
   * resend doesn't strand the code that actually arrived). A match uses it up. Each wrong guess
   * counts against every live code; the 5th uses a code up. No delay here: callers add the fail
   * delay, so it isn't applied twice.
   */
  async verify(identifier: OtpIdentifier, purpose: OtpPurpose, code: string): Promise<OtpVerifyResult> {
    const rows = await this.repository.pending(identifier, purpose, IDENTIFIER_24H_MAX);
    if (rows.length === 0) {
      return this.verifyFailed(identifier, purpose, 'not_found');
    }
    const now = Date.now();
    const live = rows.filter((row) => row.expires_at.getTime() > now);
    await this.repository.expire(rows.filter((row) => row.expires_at.getTime() <= now).map((row) => row.id));
    if (live.length === 0) {
      return this.verifyFailed(identifier, purpose, 'expired');
    }

    for (const row of live) {
      if (await compare(code, row.code_hash)) {
        if (await this.repository.consume(row.id, identifier, purpose)) {
          this.logEvent('verify_succeeded', identifier, purpose);
          return { verified: true, requestId: row.id };
        }
        // Spent by a concurrent request a moment ago.
        return this.verifyFailed(identifier, purpose, 'not_found');
      }
    }

    const stillPending = await Promise.all(live.map((row) => this.repository.recordWrongGuess(row.id, MAX_VERIFY_ATTEMPTS)));
    return this.verifyFailed(identifier, purpose, stillPending.some(Boolean) ? 'mismatch' : 'too_many_attempts');
  }

  private verifyFailed(
    identifier: OtpIdentifier,
    purpose: OtpPurpose,
    reason: Exclude<OtpVerifyResult, { verified: true }>['reason'],
  ): OtpVerifyResult {
    this.logEvent('verify_failed', identifier, purpose, reason);
    return { verified: false, reason };
  }

  /** Server-side only. Masks the identifier; never logs a code. */
  private logEvent(event: string, identifier: OtpIdentifier, purpose: OtpPurpose, detail?: string): void {
    this.logger.log(`otp ${event} purpose=${purpose} to=${maskIdentifier(identifier)}${detail ? ` (${detail})` : ''}`);
  }
}
