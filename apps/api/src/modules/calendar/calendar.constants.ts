// Tunable values for the Google Calendar integration.

/** Refresh the access token when it has less than this left. */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Slots whose event is pushed per job run (the rest wait for the next run). */
export const PUSH_BATCH_SIZE = 200;

/** pg_try_advisory_lock key for the calendar job, so only one instance runs it at a time. */
export const CALENDAR_JOB_LOCK_KEY = 4_200_901;

/** Who the sync's changes are recorded as in audit_log. */
export const SYNC_ACTOR_LABEL = 'Google Calendar sync';

/** Path of the OAuth callback under the API prefix; must be an authorised redirect URI in Google Cloud. */
export const OAUTH_CALLBACK_PATH = '/api/v1/admin/calendar/oauth/callback';

/** audit_log actions. */
export const CALENDAR_AUDIT_ACTION = {
  connected: 'calendar.connected',
  disconnected: 'calendar.disconnected',
} as const;

export const SLOT_SYNC_ACTION = {
  synced: 'slot.synced_from_google',
  conflict: 'slot.sync_conflict',
  blocked: 'slot.blocked',
  unblocked: 'slot.unblocked',
} as const;
