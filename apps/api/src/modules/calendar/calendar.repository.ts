import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';
import type { SlotRow } from '../availability/availability.repository';

export interface ConnectionRow {
  id: string;
  account_email: string;
  access_token_enc: string;
  refresh_token_enc: string;
  scope: string;
  token_type: string | null;
  expiry_date: Date | null;
  connected_by: string;
  connected_by_name: string | null;
  created_at: Date;
}

export interface NewConnection {
  accountEmail: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  scope: string;
  tokenType: string;
  expiresAt: Date;
  connectedBy: string;
}

export interface SyncStateRow {
  calendar_id: string;
  sync_token: string | null;
  last_synced_at: Date | null;
  last_error: string | null;
}

/** A slot with what its calendar event shows. */
export interface CalendarSlotRow extends SlotRow {
  google_event_id: string | null;
  blocked_by_google_event_id: string | null;
  calendar_sync_pending: boolean;
  session_type_name: string | null;
  practitioner_name: string;
  /** The slot's current booking, if any (what a booked slot's event shows). */
  booking_status: 'held' | 'confirmed' | 'no_show' | null;
  booking_payment_mode: 'upfront' | 'pay_after' | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
}

const SLOT_COLUMNS = `s.id, s.practitioner_id, s.slot_start, s.slot_end, s.status, s.rate_lkr_minor::text AS rate_lkr_minor,
  s.rate_usd_minor::text AS rate_usd_minor, s.session_type_id, s.block_reason, s.source, s.flagged_for_review,
  s.flag_reason, s.created_at, s.updated_at, s.google_event_id, s.blocked_by_google_event_id, s.calendar_sync_pending,
  st.name AS session_type_name, p.display_name AS practitioner_name, bk.status AS booking_status,
  bk.payment_mode AS booking_payment_mode, bc.name AS client_name, bc.phone AS client_phone, bc.email AS client_email`;

// At most one booking per slot is held or confirmed (unique index); a no-show keeps its slot booked.
const SLOT_FROM = `availability_slots s
  JOIN practitioners p ON p.id = s.practitioner_id
  LEFT JOIN session_types st ON st.id = s.session_type_id
  LEFT JOIN bookings bk ON bk.slot_id = s.id AND bk.status IN ('held', 'confirmed', 'no_show') AND s.status = 'booked'
  LEFT JOIN contacts bc ON bc.id = bk.contact_id`;

/**
 * All SQL for the Google Calendar integration: the connection (auth.google_oauth_tokens), the sync
 * state, and the slot columns the calendar keeps in step (event ids, pending updates, blocks by
 * private Google events). Slot locks are `FOR UPDATE OF s`, so staff edits wait for them.
 */
@Injectable()
export class CalendarRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Connection ─────────────────────────────────────────────────────────────────────────

  async findConnection(db: Queryable = this.db): Promise<ConnectionRow | undefined> {
    const { rows } = await db.query<ConnectionRow>(
      `SELECT t.id, t.account_email, t.access_token_enc, t.refresh_token_enc, t.scope, t.token_type, t.expiry_date,
              t.connected_by, s.name AS connected_by_name, t.created_at
       FROM auth.google_oauth_tokens t LEFT JOIN auth.staff_users s ON s.id = t.connected_by
       ORDER BY t.created_at DESC LIMIT 1`,
    );
    return rows[0];
  }

  /** One calendar is connected at a time: a new connection replaces the old one. */
  async replaceConnection(connection: NewConnection, tx: Queryable): Promise<void> {
    await tx.query('DELETE FROM auth.google_oauth_tokens');
    await tx.query(
      `INSERT INTO auth.google_oauth_tokens
         (account_email, access_token_enc, refresh_token_enc, scope, token_type, expiry_date, connected_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        connection.accountEmail,
        connection.accessTokenEnc,
        connection.refreshTokenEnc,
        connection.scope,
        connection.tokenType,
        connection.expiresAt,
        connection.connectedBy,
      ],
    );
  }

  async updateAccessToken(id: string, accessTokenEnc: string, expiresAt: Date, refreshTokenEnc?: string): Promise<void> {
    await this.db.query(
      `UPDATE auth.google_oauth_tokens
       SET access_token_enc = $2, expiry_date = $3, refresh_token_enc = COALESCE($4, refresh_token_enc)
       WHERE id = $1`,
      [id, accessTokenEnc, expiresAt, refreshTokenEnc ?? null],
    );
  }

  /** For the audit label of the staff member who started a connect. */
  async staffName(id: string): Promise<string | undefined> {
    const { rows } = await this.db.query<{ name: string }>('SELECT name FROM auth.staff_users WHERE id = $1', [id]);
    return rows[0]?.name;
  }

  async deleteConnection(tx: Queryable): Promise<void> {
    await tx.query('DELETE FROM auth.google_oauth_tokens');
  }

  // ── Sync state ─────────────────────────────────────────────────────────────────────────

  async syncState(calendarId: string): Promise<SyncStateRow | undefined> {
    const { rows } = await this.db.query<SyncStateRow>(
      'SELECT calendar_id, sync_token, last_synced_at, last_error FROM calendar_sync_state WHERE calendar_id = $1',
      [calendarId],
    );
    return rows[0];
  }

  /** After a successful run: the next incremental token, and no error. */
  async saveSyncToken(calendarId: string, syncToken: string | null): Promise<void> {
    await this.db.query(
      `INSERT INTO calendar_sync_state (calendar_id, sync_token, last_synced_at, last_error) VALUES ($1, $2, now(), NULL)
       ON CONFLICT (calendar_id) DO UPDATE SET sync_token = EXCLUDED.sync_token, last_synced_at = now(), last_error = NULL`,
      [calendarId, syncToken],
    );
  }

  /** Records a problem for the status panel. `resetToken` forces a full sync next time. */
  async saveSyncError(calendarId: string, error: string, resetToken = false): Promise<void> {
    await this.db.query(
      `INSERT INTO calendar_sync_state (calendar_id, sync_token, last_error) VALUES ($1, NULL, $2)
       ON CONFLICT (calendar_id) DO UPDATE
       SET last_error = EXCLUDED.last_error,
           sync_token = CASE WHEN $3 THEN NULL ELSE calendar_sync_state.sync_token END`,
      [calendarId, error.slice(0, 500), resetToken],
    );
  }

  /** A new or removed connection starts with a full sync. */
  async clearSyncState(tx: Queryable): Promise<void> {
    await tx.query('DELETE FROM calendar_sync_state');
  }

  // ── Outbound: slot events ──────────────────────────────────────────────────────────────

  /** After connecting, every current and future slot gets (or refreshes) its event. */
  async markUpcomingSlotsPending(tx: Queryable): Promise<void> {
    await tx.query(
      `UPDATE availability_slots SET calendar_sync_pending = true
       WHERE NOT calendar_sync_pending AND slot_end > now() AND (status <> 'deleted' OR google_event_id IS NOT NULL)`,
    );
  }

  async pendingSlotIds(limit: number): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      'SELECT id FROM availability_slots WHERE calendar_sync_pending ORDER BY slot_start LIMIT $1',
      [limit],
    );
    return rows.map((row) => row.id);
  }

  async countPending(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM availability_slots WHERE calendar_sync_pending');
    return Number(rows[0]?.n ?? 0);
  }

  async lockSlot(id: string, tx: Queryable): Promise<CalendarSlotRow | undefined> {
    const { rows } = await tx.query<CalendarSlotRow>(`SELECT ${SLOT_COLUMNS} FROM ${SLOT_FROM} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
    return rows[0];
  }

  async lockSlotByEvent(eventId: string, tx: Queryable): Promise<CalendarSlotRow | undefined> {
    const { rows } = await tx.query<CalendarSlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM ${SLOT_FROM} WHERE s.google_event_id = $1 FOR UPDATE OF s`,
      [eventId],
    );
    return rows[0];
  }

  /** The event now matches the slot. */
  async markPushed(id: string, eventId: string | null, tx: Queryable): Promise<void> {
    await tx.query('UPDATE availability_slots SET google_event_id = $2, calendar_sync_pending = false WHERE id = $1', [id, eventId]);
  }

  // ── Inbound: changes made in Google ────────────────────────────────────────────────────

  async moveSlot(id: string, start: Date, end: Date, tx: Queryable): Promise<SlotRow> {
    return this.returning(tx, 'slot_start = $2, slot_end = $3', [id, start, end]);
  }

  async deleteSlot(id: string, tx: Queryable): Promise<SlotRow> {
    return this.returning(tx, `status = 'deleted', blocked_by_google_event_id = NULL`, [id]);
  }

  async flagSlot(id: string, reason: string, tx: Queryable): Promise<SlotRow> {
    return this.returning(tx, 'flagged_for_review = true, flag_reason = $2', [id, reason]);
  }

  /** Open slots (not yet ended) overlapping [start, end), across practitioners: one clinic calendar. */
  async lockOpenSlotsOverlapping(start: Date, end: Date, tx: Queryable): Promise<CalendarSlotRow[]> {
    const { rows } = await tx.query<CalendarSlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM ${SLOT_FROM}
       WHERE s.status = 'open' AND s.slot_start < $2 AND s.slot_end > $1 AND s.slot_end > now()
       ORDER BY s.slot_start FOR UPDATE OF s`,
      [start, end],
    );
    return rows;
  }

  async lockSlotsBlockedByEvent(eventId: string, tx: Queryable): Promise<CalendarSlotRow[]> {
    const { rows } = await tx.query<CalendarSlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM ${SLOT_FROM} WHERE s.blocked_by_google_event_id = $1 ORDER BY s.slot_start FOR UPDATE OF s`,
      [eventId],
    );
    return rows;
  }

  /** Blocked by a private Google event; the slot's own event is updated next (pending). */
  async blockByEvent(id: string, eventId: string, reason: string, tx: Queryable): Promise<SlotRow> {
    return this.returning(
      tx,
      `status = 'blocked', block_reason = $3, blocked_by_google_event_id = $2, calendar_sync_pending = true`,
      [id, eventId, reason],
    );
  }

  async unblockByEvent(id: string, tx: Queryable): Promise<SlotRow> {
    return this.returning(
      tx,
      `status = 'open', block_reason = NULL, blocked_by_google_event_id = NULL, calendar_sync_pending = true`,
      [id],
    );
  }

  private async returning(tx: Queryable, assignments: string, params: unknown[]): Promise<SlotRow> {
    const { rows } = await tx.query<SlotRow>(
      `UPDATE availability_slots AS s SET ${assignments} WHERE s.id = $1
       RETURNING s.id, s.practitioner_id, s.slot_start, s.slot_end, s.status, s.rate_lkr_minor::text AS rate_lkr_minor,
                 s.rate_usd_minor::text AS rate_usd_minor, s.session_type_id, s.block_reason, s.source,
                 s.flagged_for_review, s.flag_reason, s.blocked_by_google_event_id, s.calendar_sync_pending,
                 s.created_at, s.updated_at`,
      params,
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`Slot ${String(params[0])} not found for a calendar update`);
    }
    return row;
  }
}
