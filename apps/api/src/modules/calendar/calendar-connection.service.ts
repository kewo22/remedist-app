import { Injectable, Logger } from '@nestjs/common';
import type { CalendarConnectStart, CalendarStatus } from '@remedist/shared';
import { createHash } from 'node:crypto';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { TokenCipher } from '../../common/crypto/token-cipher';
import { AppConfig } from '../../config/app-config';
import { DatabaseService } from '../../database/database.service';
import { GoogleApiError, GoogleCalendarApi } from '../../integrations/google/google-calendar.api';
import { ACCESS_TOKEN_REFRESH_MARGIN_MS, CALENDAR_AUDIT_ACTION, OAUTH_CALLBACK_PATH } from './calendar.constants';
import { CalendarNotConfiguredException, CalendarNotConnectedException } from './calendar.exceptions';
import { CalendarRepository } from './calendar.repository';
import { OAuthStateStore } from './oauth-state.store';

/** A usable access token for the connected calendar. */
export interface CalendarAccess {
  accessToken: string;
  calendarId: string;
}

/** Why connecting failed, in words for the owner (shown in the popup). */
export class CalendarConnectError extends Error {}

/**
 * The owner's Google Calendar connection (the old calendarOAuth.routes.js and the OAuth half of
 * calendar.service.js). One calendar is connected at a time; tokens are stored encrypted.
 */
@Injectable()
export class CalendarConnectionService {
  private readonly logger = new Logger(CalendarConnectionService.name);
  private readonly cipher: TokenCipher;

  constructor(
    private readonly calendar: CalendarRepository,
    private readonly google: GoogleCalendarApi,
    private readonly states: OAuthStateStore,
    private readonly audit: AuditLogRepository,
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
  ) {
    // Demo tokens aren't secrets, so demo mode uses a fixed key; real tokens need TOKEN_ENCRYPTION_KEY.
    this.cipher = new TokenCipher(
      config.calendar.oauth?.tokenEncryptionKey ?? createHash('sha256').update('remedist-demo-calendar').digest(),
    );
  }

  get calendarId(): string {
    return this.config.calendar.calendarId;
  }

  async status(): Promise<CalendarStatus> {
    const [connection, state, pendingSlots] = await Promise.all([
      this.calendar.findConnection(),
      this.calendar.syncState(this.calendarId),
      this.calendar.countPending(),
    ]);
    return {
      configured: this.google.canConnect && !this.google.isDemo,
      connected: connection !== undefined,
      accountEmail: connection?.account_email ?? null,
      calendarId: this.calendarId,
      connectedAt: connection?.created_at.toISOString() ?? null,
      connectedBy: connection?.connected_by_name ?? null,
      lastSyncedAt: state?.last_synced_at?.toISOString() ?? null,
      lastError: state?.last_error ?? null,
      pendingSlots,
    };
  }

  /** Owner-only. The popup opens Google's consent page; Google sends the owner back to the callback. */
  startConnect(staff: CurrentStaff): CalendarConnectStart {
    if (!this.google.canConnect) {
      throw new CalendarNotConfiguredException();
    }
    return { url: this.google.consentUrl(this.states.issue(staff.id), this.redirectUri()) };
  }

  /**
   * Google's redirect. Replaces any earlier connection, starts the next sync from scratch and marks
   * every upcoming slot so its event is created (or refreshed) on the next job run.
   */
  async completeConnect(code: string | undefined, state: string | undefined, googleError: string | undefined): Promise<void> {
    const staffUserId = state ? this.states.consume(state) : undefined;
    if (!staffUserId) {
      throw new CalendarConnectError('This connect link expired or was already used. Please try again from the CRM.');
    }
    if (googleError) {
      throw new CalendarConnectError(googleError === 'access_denied' ? 'Access to Google Calendar wasn’t granted.' : 'Google didn’t complete the connection.');
    }
    if (!code) {
      throw new CalendarConnectError('Google didn’t return an authorisation code.');
    }

    let result;
    try {
      result = await this.google.exchangeCode(code, this.redirectUri());
    } catch (error) {
      this.logger.error('Google Calendar code exchange failed', error instanceof Error ? error.stack : undefined);
      throw new CalendarConnectError('Google didn’t accept the connection. Please try again.');
    }
    const { tokens, accountEmail } = result;
    if (!tokens.refreshToken) {
      throw new CalendarConnectError('Google didn’t grant offline access. Please try again.');
    }

    await this.db.transaction(async (tx) => {
      await this.calendar.replaceConnection(
        {
          accountEmail,
          accessTokenEnc: this.cipher.encrypt(tokens.accessToken),
          refreshTokenEnc: this.cipher.encrypt(tokens.refreshToken ?? ''),
          scope: tokens.scope,
          tokenType: tokens.tokenType,
          expiresAt: tokens.expiresAt,
          connectedBy: staffUserId,
        },
        tx,
      );
      await this.calendar.clearSyncState(tx);
      await this.calendar.markUpcomingSlotsPending(tx);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staffUserId,
          actorLabel: (await this.staffName(staffUserId)) ?? 'Staff',
          action: CALENDAR_AUDIT_ACTION.connected,
          entityType: 'google_calendar',
          after: { accountEmail, calendarId: this.calendarId },
        },
        tx,
      );
    });
  }

  /** Revokes Google's access (best effort) and forgets the tokens. Events already made stay in Google. */
  async disconnect(staff: CurrentStaff, info: ClientInfo): Promise<void> {
    const connection = await this.calendar.findConnection();
    if (!connection) {
      throw new CalendarNotConnectedException();
    }
    try {
      await this.google.revoke(this.cipher.decrypt(connection.refresh_token_enc));
    } catch (error) {
      this.logger.warn(`Google token revoke failed; removing the connection anyway (${describe(error)})`);
    }
    await this.db.transaction(async (tx) => {
      await this.calendar.deleteConnection(tx);
      await this.calendar.clearSyncState(tx);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staff.id,
          actorLabel: staff.name,
          action: CALENDAR_AUDIT_ACTION.disconnected,
          entityType: 'google_calendar',
          before: { accountEmail: connection.account_email },
          requestId: info.requestId,
          ipAddress: info.ipAddress,
        },
        tx,
      );
    });
  }

  /**
   * A valid access token, refreshed when it's about to expire, or undefined when nothing is
   * connected or Google refused (recorded for the status panel).
   */
  async access(): Promise<CalendarAccess | undefined> {
    const connection = await this.calendar.findConnection();
    if (!connection) {
      return undefined;
    }
    try {
      if (connection.expiry_date && connection.expiry_date.getTime() - Date.now() > ACCESS_TOKEN_REFRESH_MARGIN_MS) {
        return { accessToken: this.cipher.decrypt(connection.access_token_enc), calendarId: this.calendarId };
      }
      const refreshed = await this.google.refresh(this.cipher.decrypt(connection.refresh_token_enc));
      await this.calendar.updateAccessToken(
        connection.id,
        this.cipher.encrypt(refreshed.accessToken),
        refreshed.expiresAt,
        refreshed.refreshToken ? this.cipher.encrypt(refreshed.refreshToken) : undefined,
      );
      return { accessToken: refreshed.accessToken, calendarId: this.calendarId };
    } catch (error) {
      const message =
        error instanceof GoogleApiError && error.isRevoked
          ? 'Google access was revoked or expired. Please connect the calendar again.'
          : 'Couldn’t get a Google access token. Will retry on the next run.';
      this.logger.error(`Google Calendar access failed: ${describe(error)}`);
      await this.recordError(message);
      return undefined;
    }
  }

  /** Shown on the status panel until the next successful sync. */
  async recordError(message: string): Promise<void> {
    await this.calendar.saveSyncError(this.calendarId, message);
  }

  private redirectUri(): string {
    return `${this.config.appUrl}${OAUTH_CALLBACK_PATH}`;
  }

  private staffName(id: string): Promise<string | undefined> {
    return this.calendar.staffName(id);
  }
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
