import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/app-config';

// Google OAuth (the owner's "Connect") and the Calendar v3 REST API, through fetch. Tokens are
// never logged.

export interface GoogleOAuthTokens {
  accessToken: string;
  /** Only on the first exchange (and not always on a refresh). */
  refreshToken?: string;
  expiresAt: Date;
  scope: string;
  tokenType: string;
}

/** An event time: `dateTime` (with offset) for timed events, `date` ("YYYY-MM-DD") for all-day ones. */
export interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

/** The parts of a Calendar event the sync reads. Cancelled events may carry only id and status. */
export interface GoogleCalendarEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  /** 'transparent' means the event shows as free. */
  transparency?: 'opaque' | 'transparent';
  /** 'default', 'workingLocation', 'outOfOffice', 'focusTime', 'birthday', 'fromGmail'... */
  eventType?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  extendedProperties?: { private?: Record<string, string> };
}

/** What the app writes for a slot's own event. */
export interface SlotEventWrite {
  slotId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  /** Shows as free (open slots) rather than busy. */
  free: boolean;
  timeZone: string;
}

export interface GoogleEventPage {
  events: GoogleCalendarEvent[];
  nextPageToken: string | null;
  nextSyncToken: string | null;
}

/** The private extended property that marks an event as a slot's own. */
export const SLOT_ID_PROPERTY = 'remedistSlotId';

/** A Google API call failed. `status` is the HTTP status (0 for a network error or timeout). */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'GoogleApiError';
  }

  /** The event no longer exists (deleted, or in another account's calendar). */
  get isGone(): boolean {
    return this.status === 404 || this.status === 410;
  }

  /** The refresh token was revoked or expired: the owner has to connect again. */
  get isRevoked(): boolean {
    return this.status === 400 && /invalid_grant/.test(this.message);
  }
}

/** The incremental sync token is too old: start again with a full sync. */
export class SyncTokenExpiredError extends Error {
  constructor() {
    super('Google Calendar sync token expired');
    this.name = 'SyncTokenExpiredError';
  }
}

/** Connecting is impossible here (no Google client settings in production). */
export class CalendarUnavailableError extends Error {
  constructor() {
    super('Google Calendar is not configured');
    this.name = 'CalendarUnavailableError';
  }
}

export abstract class GoogleCalendarApi {
  abstract readonly isDemo: boolean;
  /** False when connecting is impossible (demo mode in production). */
  abstract readonly canConnect: boolean;
  abstract consentUrl(state: string, redirectUri: string): string;
  abstract exchangeCode(code: string, redirectUri: string): Promise<{ tokens: GoogleOAuthTokens; accountEmail: string }>;
  abstract refresh(refreshToken: string): Promise<GoogleOAuthTokens>;
  abstract revoke(token: string): Promise<void>;
  abstract insertEvent(accessToken: string, calendarId: string, event: SlotEventWrite): Promise<string>;
  /** Throws GoogleApiError with isGone when the event doesn't exist any more. */
  abstract patchEvent(accessToken: string, calendarId: string, eventId: string, event: SlotEventWrite): Promise<void>;
  /** An event that's already gone counts as deleted. */
  abstract deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  /** Without a sync token, lists from `timeMin`. Throws SyncTokenExpiredError when the token is too old. */
  abstract listEvents(
    accessToken: string,
    calendarId: string,
    page: { syncToken?: string; pageToken?: string; timeMin: Date },
  ): Promise<GoogleEventPage>;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars';
/** Events only (not calendar settings), plus the account's email to show who's connected. */
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];
const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 250;

function eventBody(event: SlotEventWrite): Record<string, unknown> {
  return {
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
    end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
    transparency: event.free ? 'transparent' : 'opaque',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
    extendedProperties: { private: { [SLOT_ID_PROPERTY]: event.slotId } },
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

function toTokens(response: TokenResponse): GoogleOAuthTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: new Date(Date.now() + response.expires_in * 1000),
    scope: response.scope,
    tokenType: response.token_type,
  };
}

export class RestGoogleCalendarApi extends GoogleCalendarApi {
  readonly isDemo = false;
  readonly canConnect = true;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    super();
  }

  consentUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      // A refresh token, even when the account connected before.
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<{ tokens: GoogleOAuthTokens; accountEmail: string }> {
    const tokens = toTokens(
      await this.form<TokenResponse>(TOKEN_URL, {
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    );
    const user = await this.json<{ email?: string }>('GET', USERINFO_URL, tokens.accessToken);
    if (!user.email) {
      throw new GoogleApiError(0, 'Google did not return the account email');
    }
    return { tokens, accountEmail: user.email };
  }

  async refresh(refreshToken: string): Promise<GoogleOAuthTokens> {
    return toTokens(
      await this.form<TokenResponse>(TOKEN_URL, {
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    );
  }

  async revoke(token: string): Promise<void> {
    await this.form<unknown>(REVOKE_URL, { token });
  }

  async insertEvent(accessToken: string, calendarId: string, event: SlotEventWrite): Promise<string> {
    const created = await this.json<{ id: string }>('POST', this.eventsUrl(calendarId), accessToken, eventBody(event));
    return created.id;
  }

  async patchEvent(accessToken: string, calendarId: string, eventId: string, event: SlotEventWrite): Promise<void> {
    await this.json('PATCH', `${this.eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, accessToken, eventBody(event));
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    try {
      await this.json('DELETE', `${this.eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, accessToken);
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.isGone)) {
        throw error;
      }
    }
  }

  async listEvents(
    accessToken: string,
    calendarId: string,
    page: { syncToken?: string; pageToken?: string; timeMin: Date },
  ): Promise<GoogleEventPage> {
    // showDeleted and singleEvents must be the same on the full sync and every incremental one.
    const params = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true', maxResults: String(PAGE_SIZE) });
    if (page.syncToken) {
      params.set('syncToken', page.syncToken);
    } else {
      params.set('timeMin', page.timeMin.toISOString());
    }
    if (page.pageToken) {
      params.set('pageToken', page.pageToken);
    }
    try {
      const result = await this.json<{ items?: GoogleCalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
        'GET',
        `${this.eventsUrl(calendarId)}?${params.toString()}`,
        accessToken,
      );
      return {
        events: result.items ?? [],
        nextPageToken: result.nextPageToken ?? null,
        nextSyncToken: result.nextSyncToken ?? null,
      };
    } catch (error) {
      if (page.syncToken && error instanceof GoogleApiError && error.status === 410) {
        throw new SyncTokenExpiredError();
      }
      throw error;
    }
  }

  private eventsUrl(calendarId: string): string {
    return `${CALENDAR_URL}/${encodeURIComponent(calendarId)}/events`;
  }

  private async form<T>(url: string, fields: Record<string, string>): Promise<T> {
    return this.send<T>(url, { method: 'POST', body: new URLSearchParams(fields) });
  }

  private async json<T = unknown>(method: string, url: string, accessToken: string, body?: unknown): Promise<T> {
    return this.send<T>(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async send<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new GoogleApiError(0, `Google request failed: ${init.method ?? 'GET'} ${new URL(url).pathname}`, { cause: error });
    }
    const text = await response.text();
    if (!response.ok) {
      // Google's error text names the problem (e.g. invalid_grant, notFound), never our tokens.
      let detail = '';
      try {
        const parsed = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
        detail = typeof parsed.error === 'string' ? `${parsed.error} ${parsed.error_description ?? ''}` : (parsed.error?.message ?? '');
      } catch {
        detail = '';
      }
      throw new GoogleApiError(response.status, `Google ${response.status} on ${new URL(url).pathname}: ${detail.trim()}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/**
 * No GOOGLE_OAUTH_CLIENT_SECRET. Outside production "Connect" goes straight back to the callback with
 * a demo code, and events live in memory, so the CRM flow and slot events can be tried locally. In
 * production connecting is refused.
 */
export class DemoGoogleCalendarApi extends GoogleCalendarApi {
  readonly isDemo = true;
  private readonly events = new Map<string, GoogleCalendarEvent>();
  /** Event ids in the order they changed; a sync token is a position in this list. */
  private readonly changes: string[] = [];

  constructor(readonly canConnect: boolean) {
    super();
  }

  consentUrl(state: string, redirectUri: string): string {
    this.requireAllowed();
    return `${redirectUri}?${new URLSearchParams({ code: 'demo', state }).toString()}`;
  }

  exchangeCode(code: string): Promise<{ tokens: GoogleOAuthTokens; accountEmail: string }> {
    this.requireAllowed();
    if (code !== 'demo') {
      return Promise.reject(new GoogleApiError(400, 'invalid_grant demo mode only accepts the demo code'));
    }
    return Promise.resolve({
      tokens: { accessToken: 'demo-access', refreshToken: 'demo-refresh', expiresAt: new Date(Date.now() + 3600_000), scope: SCOPES.join(' '), tokenType: 'Bearer' },
      accountEmail: 'demo-calendar@remedist.test',
    });
  }

  refresh(): Promise<GoogleOAuthTokens> {
    return Promise.resolve({ accessToken: 'demo-access', expiresAt: new Date(Date.now() + 3600_000), scope: SCOPES.join(' '), tokenType: 'Bearer' });
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }

  insertEvent(_token: string, _calendarId: string, event: SlotEventWrite): Promise<string> {
    const id = `demo${randomUUID().replace(/-/g, '')}`;
    this.store({ id, ...this.toEvent(event) });
    return Promise.resolve(id);
  }

  patchEvent(_token: string, _calendarId: string, eventId: string, event: SlotEventWrite): Promise<void> {
    const existing = this.events.get(eventId);
    if (!existing || existing.status === 'cancelled') {
      return Promise.reject(new GoogleApiError(404, 'Google 404: notFound'));
    }
    this.store({ id: eventId, ...this.toEvent(event) });
    return Promise.resolve();
  }

  deleteEvent(_token: string, _calendarId: string, eventId: string): Promise<void> {
    if (this.events.has(eventId)) {
      this.store({ id: eventId, status: 'cancelled' });
    }
    return Promise.resolve();
  }

  listEvents(_token: string, _calendarId: string, page: { syncToken?: string }): Promise<GoogleEventPage> {
    const from = page.syncToken ? Number(page.syncToken) : 0;
    if (Number.isNaN(from) || from > this.changes.length) {
      return Promise.reject(new SyncTokenExpiredError());
    }
    const ids = [...new Set(this.changes.slice(from))];
    return Promise.resolve({
      events: ids.flatMap((id) => {
        const event = this.events.get(id);
        return event ? [event] : [];
      }),
      nextPageToken: null,
      nextSyncToken: String(this.changes.length),
    });
  }

  /** Demo only: someone edits the calendar in Google directly (used by the local checks). */
  simulateGoogleChange(event: GoogleCalendarEvent): void {
    this.store(event);
  }

  /** Demo only: the event as Google holds it. */
  peek(eventId: string): GoogleCalendarEvent | undefined {
    return this.events.get(eventId);
  }

  private store(event: GoogleCalendarEvent): void {
    this.events.set(event.id, event);
    this.changes.push(event.id);
  }

  private toEvent(event: SlotEventWrite): Omit<GoogleCalendarEvent, 'id'> {
    return {
      status: 'confirmed',
      summary: event.summary,
      transparency: event.free ? 'transparent' : 'opaque',
      start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
      end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
      extendedProperties: { private: { [SLOT_ID_PROPERTY]: event.slotId } },
    };
  }

  private requireAllowed(): void {
    if (!this.canConnect) {
      throw new CalendarUnavailableError();
    }
  }
}

export function createGoogleCalendarApi(config: AppConfig): GoogleCalendarApi {
  const oauth = config.calendar.oauth;
  if (oauth) {
    return new RestGoogleCalendarApi(oauth.clientId, oauth.clientSecret);
  }
  const logger = new Logger('GoogleCalendar');
  if (config.isProduction) {
    logger.warn('GOOGLE_OAUTH_CLIENT_SECRET is not set: Google Calendar can’t be connected');
  } else {
    logger.warn('GOOGLE_OAUTH_CLIENT_SECRET is not set: "Connect" links an in-memory demo calendar (demo mode)');
  }
  return new DemoGoogleCalendarApi(!config.isProduction);
}
