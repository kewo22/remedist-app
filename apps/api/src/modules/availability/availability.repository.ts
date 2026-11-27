import { Injectable } from '@nestjs/common';
import { CLINIC_TIME_ZONE, type SlotSource, type SlotStatus } from '@remedist/shared';
import { DatabaseService, Queryable } from '../../database/database.service';

/** money_minor is BIGINT, which pg returns as text; the mappers convert it. */
type MinorText = string | null;

export interface SessionTypeRow {
  id: string;
  name: string;
  duration_minutes: number;
  rate_lkr_minor: MinorText;
  rate_usd_minor: MinorText;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PractitionerRow {
  id: string;
  display_name: string;
  title: string | null;
}

/** A slot as it's locked and changed. */
export interface SlotRow {
  id: string;
  practitioner_id: string;
  slot_start: Date;
  slot_end: Date;
  status: SlotStatus;
  rate_lkr_minor: MinorText;
  rate_usd_minor: MinorText;
  session_type_id: string | null;
  block_reason: string | null;
  source: SlotSource;
  flagged_for_review: boolean;
  flag_reason: string | null;
  /** The private Google event blocking it, if any. */
  blocked_by_google_event_id: string | null;
  /** Its Google Calendar event hasn't caught up with a change yet. */
  calendar_sync_pending: boolean;
  created_at: Date;
  updated_at: Date;
}

/** A slot with its practitioner, session type and current booking, for the CRM. */
export interface AdminSlotRow extends SlotRow {
  practitioner_name: string;
  session_type_name: string | null;
  booking_id: string | null;
  booking_status: 'held' | 'confirmed' | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export interface PublicSlotRow {
  id: string;
  practitioner_id: string;
  practitioner_name: string;
  slot_start: Date;
  slot_end: Date;
  rate_lkr_minor: MinorText;
  rate_usd_minor: MinorText;
}

export interface NewSlot {
  practitionerId: string;
  start: Date;
  end: Date;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
  sessionTypeId: string;
  createdBy: string;
}

export interface SlotChanges {
  start: Date;
  end: Date;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
  sessionTypeId: string | null;
}

export interface SessionTypeFields {
  name: string;
  durationMinutes: number;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
}

/** Constraint and index names, for isExclusionViolation / isUniqueViolation. */
export const SLOT_OVERLAP_CONSTRAINT = 'availability_slots_no_overlap';
export const SESSION_TYPE_NAME_INDEX = 'session_types_name_key';

const SESSION_TYPE_COLUMNS = `id, name, duration_minutes, rate_lkr_minor::text, rate_usd_minor::text, is_active, created_at, updated_at`;

const SLOT_COLUMNS = `s.id, s.practitioner_id, s.slot_start, s.slot_end, s.status, s.rate_lkr_minor::text AS rate_lkr_minor,
  s.rate_usd_minor::text AS rate_usd_minor, s.session_type_id, s.block_reason, s.source, s.flagged_for_review,
  s.flag_reason, s.blocked_by_google_event_id, s.calendar_sync_pending, s.created_at, s.updated_at`;

const ADMIN_SLOT_SELECT = `
  SELECT ${SLOT_COLUMNS}, p.display_name AS practitioner_name, st.name AS session_type_name,
         b.id AS booking_id, b.status AS booking_status, c.id AS contact_id, c.name AS contact_name,
         c.email AS contact_email, c.phone AS contact_phone
  FROM availability_slots s
  JOIN practitioners p ON p.id = s.practitioner_id
  LEFT JOIN session_types st ON st.id = s.session_type_id
  LEFT JOIN bookings b ON b.slot_id = s.id AND b.status IN ('held', 'confirmed')
  LEFT JOIN contacts c ON c.id = b.contact_id`;

/** All SQL for session types, slots and the practitioners slots are opened for. */
@Injectable()
export class AvailabilityRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Session types ──────────────────────────────────────────────────────────────────────

  /** Active first, then shortest, then by name (as the old list). */
  async listSessionTypes(includeRetired: boolean): Promise<SessionTypeRow[]> {
    const { rows } = await this.db.query<SessionTypeRow>(
      `SELECT ${SESSION_TYPE_COLUMNS} FROM session_types
       WHERE $1 OR is_active
       ORDER BY is_active DESC, duration_minutes, lower(name)`,
      [includeRetired],
    );
    return rows;
  }

  async findSessionType(id: string, db: Queryable = this.db): Promise<SessionTypeRow | undefined> {
    const { rows } = await db.query<SessionTypeRow>(`SELECT ${SESSION_TYPE_COLUMNS} FROM session_types WHERE id = $1`, [id]);
    return rows[0];
  }

  async findSessionTypeForUpdate(id: string, tx: Queryable): Promise<SessionTypeRow | undefined> {
    const { rows } = await tx.query<SessionTypeRow>(
      `SELECT ${SESSION_TYPE_COLUMNS} FROM session_types WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  /** Locks every active type, so two retirements can't both pass the "keep one" check. */
  async lockActiveSessionTypeIds(tx: Queryable): Promise<string[]> {
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM session_types WHERE is_active FOR UPDATE');
    return rows.map((row) => row.id);
  }

  /** The type the walk-in kiosk opens its slot as: the oldest active one (the clinic's standard session). */
  async defaultSessionType(): Promise<SessionTypeRow | undefined> {
    const { rows } = await this.db.query<SessionTypeRow>(
      `SELECT ${SESSION_TYPE_COLUMNS} FROM session_types WHERE is_active ORDER BY created_at, id LIMIT 1`,
    );
    return rows[0];
  }

  async createSessionType(fields: SessionTypeFields, tx: Queryable): Promise<SessionTypeRow> {
    const { rows } = await tx.query<SessionTypeRow>(
      `INSERT INTO session_types (name, duration_minutes, rate_lkr_minor, rate_usd_minor) VALUES ($1, $2, $3, $4)
       RETURNING ${SESSION_TYPE_COLUMNS}`,
      [fields.name, fields.durationMinutes, fields.rateLkrMinor, fields.rateUsdMinor],
    );
    return this.required(rows[0]);
  }

  async updateSessionType(id: string, fields: SessionTypeFields, tx: Queryable): Promise<SessionTypeRow> {
    const { rows } = await tx.query<SessionTypeRow>(
      `UPDATE session_types SET name = $2, duration_minutes = $3, rate_lkr_minor = $4, rate_usd_minor = $5
       WHERE id = $1 RETURNING ${SESSION_TYPE_COLUMNS}`,
      [id, fields.name, fields.durationMinutes, fields.rateLkrMinor, fields.rateUsdMinor],
    );
    return this.required(rows[0]);
  }

  async setSessionTypeActive(id: string, active: boolean, tx: Queryable): Promise<SessionTypeRow> {
    const { rows } = await tx.query<SessionTypeRow>(
      `UPDATE session_types SET is_active = $2 WHERE id = $1 RETURNING ${SESSION_TYPE_COLUMNS}`,
      [id, active],
    );
    return this.required(rows[0]);
  }

  // ── Practitioners ──────────────────────────────────────────────────────────────────────

  async activePractitioners(): Promise<PractitionerRow[]> {
    const { rows } = await this.db.query<PractitionerRow>(
      'SELECT id, display_name, title FROM practitioners WHERE is_active ORDER BY display_name',
    );
    return rows;
  }

  // ── Slots: reading ─────────────────────────────────────────────────────────────────────

  /** Every slot but deleted ones starting in [from, to), for the CRM calendar. */
  async listAdminSlots(from: Date, to: Date, practitionerId?: string): Promise<AdminSlotRow[]> {
    const { rows } = await this.db.query<AdminSlotRow>(
      `${ADMIN_SLOT_SELECT}
       WHERE s.status <> 'deleted' AND s.slot_start >= $1 AND s.slot_start < $2
         AND ($3::uuid IS NULL OR s.practitioner_id = $3)
       ORDER BY s.slot_start, p.display_name`,
      [from, to, practitionerId ?? null],
    );
    return rows;
  }

  async findAdminSlot(id: string): Promise<AdminSlotRow | undefined> {
    const { rows } = await this.db.query<AdminSlotRow>(`${ADMIN_SLOT_SELECT} WHERE s.id = $1`, [id]);
    return rows[0];
  }

  /** Open slots of active practitioners starting in [notBefore, to). */
  async listOpenSlots(notBefore: Date, to: Date, practitionerId?: string): Promise<PublicSlotRow[]> {
    const { rows } = await this.db.query<PublicSlotRow>(
      `SELECT s.id, s.practitioner_id, p.display_name AS practitioner_name, s.slot_start, s.slot_end,
              s.rate_lkr_minor::text AS rate_lkr_minor, s.rate_usd_minor::text AS rate_usd_minor
       FROM availability_slots s JOIN practitioners p ON p.id = s.practitioner_id
       WHERE s.status = 'open' AND p.is_active AND s.slot_start >= $1 AND s.slot_start < $2
         AND ($3::uuid IS NULL OR s.practitioner_id = $3)
       ORDER BY s.slot_start, p.display_name`,
      [notBefore, to, practitionerId ?? null],
    );
    return rows;
  }

  /** Clinic-local dates that have an open slot starting in [notBefore, to). */
  async datesWithOpenSlots(notBefore: Date, to: Date, practitionerId?: string): Promise<string[]> {
    const { rows } = await this.db.query<{ date: string }>(
      `SELECT DISTINCT to_char(s.slot_start AT TIME ZONE $4, 'YYYY-MM-DD') AS date
       FROM availability_slots s JOIN practitioners p ON p.id = s.practitioner_id
       WHERE s.status = 'open' AND p.is_active AND s.slot_start >= $1 AND s.slot_start < $2
         AND ($3::uuid IS NULL OR s.practitioner_id = $3)
       ORDER BY date`,
      [notBefore, to, practitionerId ?? null, CLINIC_TIME_ZONE],
    );
    return rows.map((row) => row.date);
  }

  // ── Slots: changing (inside the caller's transaction) ─────────────────────────────────

  async findSlotForUpdate(id: string, tx: Queryable): Promise<SlotRow | undefined> {
    const { rows } = await tx.query<SlotRow>(`SELECT ${SLOT_COLUMNS} FROM availability_slots s WHERE s.id = $1 FOR UPDATE`, [id]);
    return rows[0];
  }

  /** The overlap constraint rejects a clash with another of the practitioner's slots (23P01). */
  async insertSlot(slot: NewSlot, tx: Queryable): Promise<SlotRow> {
    const { rows } = await tx.query<SlotRow>(
      `INSERT INTO availability_slots AS s
         (practitioner_id, slot_start, slot_end, status, rate_lkr_minor, rate_usd_minor, session_type_id, source, created_by,
          calendar_sync_pending)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, 'manual', $7, true)
       RETURNING ${SLOT_COLUMNS}`,
      [slot.practitionerId, slot.start, slot.end, slot.rateLkrMinor, slot.rateUsdMinor, slot.sessionTypeId, slot.createdBy],
    );
    return this.required(rows[0]);
  }

  async updateSlot(id: string, changes: SlotChanges, tx: Queryable): Promise<SlotRow> {
    const { rows } = await tx.query<SlotRow>(
      `UPDATE availability_slots AS s
       SET slot_start = $2, slot_end = $3, rate_lkr_minor = $4, rate_usd_minor = $5, session_type_id = $6,
           calendar_sync_pending = true
       WHERE s.id = $1 RETURNING ${SLOT_COLUMNS}`,
      [id, changes.start, changes.end, changes.rateLkrMinor, changes.rateUsdMinor, changes.sessionTypeId],
    );
    return this.required(rows[0]);
  }

  /**
   * Changes the status (and block reason). The caller has checked the current status under the lock.
   * A staff change replaces any block by a Google event, and marks the calendar event for an update.
   */
  async setSlotStatus(id: string, status: SlotStatus, blockReason: string | null, tx: Queryable): Promise<SlotRow> {
    const { rows } = await tx.query<SlotRow>(
      `UPDATE availability_slots AS s
       SET status = $2, block_reason = $3, blocked_by_google_event_id = NULL, calendar_sync_pending = true
       WHERE s.id = $1 RETURNING ${SLOT_COLUMNS}`,
      [id, status, blockReason],
    );
    return this.required(rows[0]);
  }

  async clearSlotFlag(id: string, tx: Queryable): Promise<SlotRow> {
    const { rows } = await tx.query<SlotRow>(
      `UPDATE availability_slots AS s SET flagged_for_review = false, flag_reason = NULL WHERE s.id = $1
       RETURNING ${SLOT_COLUMNS}`,
      [id],
    );
    return this.required(rows[0]);
  }

  private required<T>(row: T | undefined): T {
    if (!row) {
      throw new Error('Expected a row from availability write');
    }
    return row;
  }
}
