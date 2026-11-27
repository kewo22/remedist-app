// Google Calendar: the clinic calendar an owner connects. Every slot gets one event there, kept in
// step as the slot changes, and a job syncs back from Google every 5 minutes: private events block
// overlapping open slots, and changes to a booked slot's event are flagged for staff to review.

export const ADMIN_CALENDAR_ROUTES = {
  /** GET → CalendarStatus. schedule.manage. */
  status: '/admin/calendar',
  /**
   * POST → CalendarConnectStart. settings.manage. Open `url` in a popup; when Google sends the owner
   * back, the popup posts a CalendarOAuthMessage to the CRM window and closes.
   */
  connect: '/admin/calendar/connect',
  /** Google's redirect target (not called by the web app). Answers with a small HTML page. */
  oauthCallback: '/admin/calendar/oauth/callback',
  /** POST → CalendarStatus. settings.manage. Revokes the access; events already made stay in Google. */
  disconnect: '/admin/calendar/disconnect',
  /** POST → CalendarSyncResult. settings.manage. Runs the 5-minute job now. */
  sync: '/admin/calendar/sync',
} as const;

export interface CalendarStatus {
  /** False when the server has no Google client settings (demo mode outside production). */
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string;
  connectedAt: string | null;
  connectedBy: string | null;
  lastSyncedAt: string | null;
  /** The last sync or update problem, in plain words; null when the last run was fine. */
  lastError: string | null;
  /** Slots whose calendar event hasn't been updated yet (retried every 5 minutes). */
  pendingSlots: number;
}

export interface CalendarConnectStart {
  /** Google's consent page. Valid for 10 minutes, once. */
  url: string;
}

/** What the OAuth popup posts to window.opener (target origin: the web app). */
export const CALENDAR_OAUTH_MESSAGE_TYPE = 'remedist:google-calendar-connect';
export interface CalendarOAuthMessage {
  type: typeof CALENDAR_OAUTH_MESSAGE_TYPE;
  ok: boolean;
  /** Plain words for the owner when ok is false. */
  error: string | null;
}

export interface CalendarSyncResult {
  /** Slot events created, moved or updated in Google. */
  pushed: number;
  /** Slots that still couldn't be updated. */
  stillPending: number;
  /** Google events read and reconciled. */
  eventsRead: number;
}
