import { Controller, Get, Header, HttpCode, HttpStatus, Logger, Post, Query, Req, Res } from '@nestjs/common';
import {
  CALENDAR_OAUTH_MESSAGE_TYPE,
  Permission,
  type CalendarConnectStart,
  type CalendarOAuthMessage,
  type CalendarStatus,
  type CalendarSyncResult,
} from '@remedist/shared';
import type { Request, Response } from 'express';
import { CurrentUser, PublicRoute, StaffOnly } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { AppConfig } from '../../config/app-config';
import { CalendarConnectError, CalendarConnectionService, describe } from './calendar-connection.service';
import { CalendarSyncJob } from './calendar-sync.job';
import { CalendarSyncBusyException } from './calendar.exceptions';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The page Google sends the popup to: tells the CRM window how it went, then closes. */
function callbackPage(message: CalendarOAuthMessage, webOrigin: string): string {
  // JSON in a script: escape "<" so no value can close the tag.
  const payload = JSON.stringify(message).replace(/</g, '\\u003c');
  const origin = JSON.stringify(webOrigin).replace(/</g, '\\u003c');
  const text = message.ok ? 'Google Calendar is connected. You can close this window.' : `Couldn’t connect: ${message.error ?? ''}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Google Calendar</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;padding:2rem"><p>${escapeHtml(text)}</p>
<script>
  if (window.opener) { window.opener.postMessage(${payload}, ${origin}); window.close(); }
</script></body></html>`;
}

/** Google Calendar in the CRM. ADMIN_CALENDAR_ROUTES. */
@Controller('admin/calendar')
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);

  constructor(
    private readonly connection: CalendarConnectionService,
    private readonly job: CalendarSyncJob,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @StaffOnly(Permission.SCHEDULE_MANAGE)
  @ResponseMessage('Google Calendar')
  status(): Promise<CalendarStatus> {
    return this.connection.status();
  }

  /** Owners (settings.manage), as in the old app: it's the clinic-wide calendar. */
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @StaffOnly(Permission.SETTINGS_MANAGE)
  @ResponseMessage('Continue in the Google window')
  connect(@CurrentUser() staff: CurrentStaff): CalendarConnectStart {
    return this.connection.startConnect(staff);
  }

  /** Google's browser redirect: no CRM token, so it trusts only a one-time state from `connect`. */
  @Get('oauth/callback')
  @PublicRoute()
  @SkipEnvelope()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async oauthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') googleError: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const message: CalendarOAuthMessage = { type: CALENDAR_OAUTH_MESSAGE_TYPE, ok: true, error: null };
    try {
      await this.connection.completeConnect(asText(code), asText(state), asText(googleError));
      // Create the slot events and read the calendar now rather than in up to 5 minutes.
      void this.job.runLocked().catch((error: unknown) => {
        if (!(error instanceof CalendarSyncBusyException)) {
          this.logger.error(`First calendar sync after connecting failed: ${describe(error)}`);
        }
      });
    } catch (error) {
      message.ok = false;
      message.error = error instanceof CalendarConnectError ? error.message : 'Something went wrong completing the connection.';
      if (!(error instanceof CalendarConnectError)) {
        this.logger.error(`Google Calendar connect failed: ${describe(error)}`, error instanceof Error ? error.stack : undefined);
      }
      response.status(HttpStatus.BAD_REQUEST);
    }
    return callbackPage(message, this.config.webUrl);
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @StaffOnly(Permission.SETTINGS_MANAGE)
  @ResponseMessage('Google Calendar disconnected')
  async disconnect(@CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<CalendarStatus> {
    await this.connection.disconnect(staff, clientInfo(request));
    return this.connection.status();
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @StaffOnly(Permission.SETTINGS_MANAGE)
  @ResponseMessage('Calendar synced')
  sync(): Promise<CalendarSyncResult> {
    return this.job.runLocked();
  }
}

/** Query values can arrive as arrays (?code=a&code=b); only a single string counts. */
function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
