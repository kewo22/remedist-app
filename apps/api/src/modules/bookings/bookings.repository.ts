import { Injectable } from '@nestjs/common';
import {
  OVERDUE_LOCKOUT_DAYS,
  type BookedVia,
  type BookingStatus,
  type BookingType,
  type Currency,
  type IntakeStatus,
  type PaymentMode,
} from '@remedist/shared';
import { DatabaseService, Queryable } from '../../database/database.service';

/** A booking with what every view shows: client, practitioner, balance and Part 2 status. */
export interface BookingViewRow {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  registration_number: string | null;
  status: BookingStatus;
  booking_type: BookingType;
  booked_via: BookedVia;
  slot_id: string;
  practitioner_id: string;
  practitioner_name: string;
  slot_start: Date;
  slot_end: Date;
  original_slot_start: Date;
  self_reschedule_used_at: Date | null;
  rate_charged_minor: string;
  currency: Currency;
  payment_mode: PaymentMode;
  due_minor: string | null;
  hold_expires_at: Date | null;
  notes: string | null;
  staff_notes: string | null;
  appointment_code: string | null;
  intake_form_id: string | null;
  intake_status: IntakeStatus | null;
  created_at: Date;
}

/** The booking row itself, as it's locked and changed. */
export interface BookingRow {
  id: string;
  contact_id: string;
  slot_id: string;
  practitioner_id: string;
  slot_start: Date;
  slot_end: Date;
  original_slot_start: Date;
  self_reschedule_used_at: Date | null;
  status: BookingStatus;
  booking_type: BookingType;
  booked_via: BookedVia;
  payment_mode: PaymentMode;
  rate_charged_minor: string;
  currency: Currency;
  hold_expires_at: Date | null;
  staff_notes: string | null;
}

export interface NewBooking {
  contactId: string;
  slotId: string;
  practitionerId: string;
  start: Date;
  end: Date;
  residency: 'lk' | 'intl';
  rateMinor: number;
  currency: Currency;
  status: 'held' | 'confirmed';
  holdExpiresAt: Date | null;
  bookingType: BookingType;
  bookedVia: BookedVia;
  paymentMode: PaymentMode;
  notes: string | null;
  staffNotes: string | null;
}

export interface BookingListFilter {
  from?: Date;
  to?: Date;
  status?: BookingStatus;
  contactId?: string;
  limit: number;
  offset: number;
}

/** Index names, for isUniqueViolation. */
export const ACTIVE_BOOKING_SLOT_INDEX = 'bookings_slot_id_active_key';

const VIEW_SELECT = `
  SELECT b.id, b.contact_id, c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone,
         c.registration_number, b.status, b.booking_type, b.booked_via, b.slot_id, b.practitioner_id,
         p.display_name AS practitioner_name, b.slot_start, b.slot_end, b.original_slot_start,
         b.self_reschedule_used_at, b.rate_charged_minor::text AS rate_charged_minor, b.currency, b.payment_mode,
         bb.due_minor::text AS due_minor, b.hold_expires_at, b.notes, b.staff_notes, b.appointment_code,
         f.id AS intake_form_id, f.status AS intake_status, b.created_at
  FROM bookings b
  JOIN contacts c ON c.id = b.contact_id
  JOIN practitioners p ON p.id = b.practitioner_id
  LEFT JOIN booking_balances bb ON bb.booking_id = b.id
  LEFT JOIN clinical.intake_forms f ON f.booking_id = b.id`;

const ROW_COLUMNS = `id, contact_id, slot_id, practitioner_id, slot_start, slot_end, original_slot_start,
  self_reschedule_used_at, status, booking_type, booked_via, payment_mode, rate_charged_minor::text AS rate_charged_minor,
  currency, hold_expires_at, staff_notes`;

/** All SQL for bookings, appointment codes and strikes. Slot claims are in AvailabilityRepository. */
@Injectable()
export class BookingsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Reading ────────────────────────────────────────────────────────────────────────────

  async findView(id: string): Promise<BookingViewRow | undefined> {
    const { rows } = await this.db.query<BookingViewRow>(`${VIEW_SELECT} WHERE b.id = $1`, [id]);
    return rows[0];
  }

  async listForContact(contactId: string): Promise<BookingViewRow[]> {
    const { rows } = await this.db.query<BookingViewRow>(`${VIEW_SELECT} WHERE b.contact_id = $1 ORDER BY b.slot_start DESC`, [
      contactId,
    ]);
    return rows;
  }

  /** Past sessions (any outcome) of several contacts: cancelled, missed, or confirmed and started. */
  async history(contactIds: readonly string[]): Promise<BookingViewRow[]> {
    const { rows } = await this.db.query<BookingViewRow>(
      `${VIEW_SELECT}
       WHERE b.contact_id = ANY($1::uuid[])
         AND (b.status IN ('cancelled', 'no_show') OR (b.status = 'confirmed' AND b.slot_start <= now()))
       ORDER BY b.slot_start DESC`,
      [contactIds],
    );
    return rows;
  }

  async list(filter: BookingListFilter): Promise<{ rows: BookingViewRow[]; total: number }> {
    const { rows } = await this.db.query<BookingViewRow & { total: string }>(
      `${VIEW_SELECT.replace('SELECT b.id,', 'SELECT count(*) OVER () AS total, b.id,')}
       WHERE ($1::timestamptz IS NULL OR b.slot_start >= $1)
         AND ($2::timestamptz IS NULL OR b.slot_start < $2)
         AND ($3::text IS NULL OR b.status = $3)
         AND ($4::uuid IS NULL OR b.contact_id = $4)
       ORDER BY b.slot_start DESC, b.id
       LIMIT $5 OFFSET $6`,
      [filter.from ?? null, filter.to ?? null, filter.status ?? null, filter.contactId ?? null, filter.limit, filter.offset],
    );
    return { rows, total: rows[0] ? Number(rows[0].total) : 0 };
  }

  // ── Changing ───────────────────────────────────────────────────────────────────────────

  async lock(id: string, tx: Queryable): Promise<BookingRow | undefined> {
    const { rows } = await tx.query<BookingRow>(`SELECT ${ROW_COLUMNS} FROM bookings WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0];
  }

  /** The unique index on active bookings per slot is a backstop for the slot claim. */
  async insert(booking: NewBooking, tx: Queryable): Promise<BookingRow> {
    const { rows } = await tx.query<BookingRow>(
      `INSERT INTO bookings
         (contact_id, slot_id, practitioner_id, slot_start, slot_end, original_slot_start, residency,
          rate_charged_minor, currency, status, hold_expires_at, booking_type, booked_via, payment_mode, notes, staff_notes)
       VALUES ($1, $2, $3, $4, $5, $4, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${ROW_COLUMNS}`,
      [
        booking.contactId,
        booking.slotId,
        booking.practitionerId,
        booking.start,
        booking.end,
        booking.residency,
        booking.rateMinor,
        booking.currency,
        booking.status,
        booking.holdExpiresAt,
        booking.bookingType,
        booking.bookedVia,
        booking.paymentMode,
        booking.notes,
        booking.staffNotes,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Booking insert returned no row');
    }
    return row;
  }

  /** Moves the booking to another slot, re-priced; the original session date never changes. */
  async moveToSlot(
    id: string,
    slot: { id: string; practitionerId: string; start: Date; end: Date; rateMinor: number; currency: Currency },
    selfService: boolean,
    tx: Queryable,
  ): Promise<void> {
    await tx.query(
      `UPDATE bookings SET slot_id = $2, practitioner_id = $3, slot_start = $4, slot_end = $5,
              rate_charged_minor = $6, currency = $7,
              self_reschedule_used_at = CASE WHEN $8 THEN now() ELSE self_reschedule_used_at END
       WHERE id = $1`,
      [id, slot.id, slot.practitionerId, slot.start, slot.end, slot.rateMinor, slot.currency, selfService],
    );
  }

  async setStatus(id: string, status: BookingStatus, tx: Queryable): Promise<void> {
    await tx.query('UPDATE bookings SET status = $2 WHERE id = $1', [id, status]);
  }

  async setStaffNotes(id: string, staffNotes: string | null, tx: Queryable): Promise<void> {
    await tx.query('UPDATE bookings SET staff_notes = $2 WHERE id = $1', [id, staffNotes]);
  }

  /** Expired checkout holds, locked; another instance's job skips the ones this one has. */
  async lockExpiredHolds(limit: number, tx: Queryable): Promise<BookingRow[]> {
    const { rows } = await tx.query<BookingRow>(
      `SELECT ${ROW_COLUMNS} FROM bookings WHERE status = 'held' AND hold_expires_at < now()
       ORDER BY hold_expires_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows;
  }

  // ── Appointment codes ──────────────────────────────────────────────────────────────────

  /** The next number for that session date (one counter per clinic-local day). */
  async nextAppointmentSequence(date: string, tx: Queryable): Promise<number> {
    const { rows } = await tx.query<{ assigned: number }>(
      `INSERT INTO sequence_counters AS sc (name, next_value) VALUES ($1, 2)
       ON CONFLICT (name) DO UPDATE SET next_value = sc.next_value + 1
       RETURNING sc.next_value - 1 AS assigned`,
      [`appt_seq:${date}`],
    );
    const assigned = rows[0]?.assigned;
    if (assigned === undefined) {
      throw new Error('sequence_counters upsert returned no row');
    }
    return assigned;
  }

  /** Makes `code` the booking's current code; the earlier one stays in the history. */
  async setAppointmentCode(bookingId: string, code: string, tx: Queryable): Promise<void> {
    await tx.query(
      'UPDATE appointment_code_history SET superseded_at = now() WHERE booking_id = $1 AND superseded_at IS NULL',
      [bookingId],
    );
    await tx.query('INSERT INTO appointment_code_history (booking_id, code) VALUES ($1, $2)', [bookingId, code]);
    await tx.query('UPDATE bookings SET appointment_code = $2 WHERE id = $1', [bookingId, code]);
  }

  async appointmentCodes(bookingId: string): Promise<Array<{ code: string; created_at: Date; superseded_at: Date | null }>> {
    const { rows } = await this.db.query<{ code: string; created_at: Date; superseded_at: Date | null }>(
      'SELECT code, created_at, superseded_at FROM appointment_code_history WHERE booking_id = $1 ORDER BY created_at DESC',
      [bookingId],
    );
    return rows;
  }

  // ── Strikes and the overdue lockout ────────────────────────────────────────────────────

  /** One strike of each kind per booking. Returns false when it was already recorded. */
  async addStrike(contactId: string, bookingId: string, type: 'no_show' | 'late_cancellation', tx: Queryable): Promise<boolean> {
    const result = await tx.query(
      `INSERT INTO contact_strikes (contact_id, booking_id, type) VALUES ($1, $2, $3)
       ON CONFLICT (booking_id, type) WHERE booking_id IS NOT NULL DO NOTHING`,
      [contactId, bookingId, type],
    );
    return result.rowCount === 1;
  }

  async strikeCount(contactId: string, db: Queryable = this.db): Promise<number> {
    const { rows } = await db.query<{ n: string }>('SELECT count(*) AS n FROM contact_strikes WHERE contact_id = $1', [contactId]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * True when a confirmed pay-after session still owes money and its original date is
   * OVERDUE_LOCKOUT_DAYS or more ago (the old isOverdueLockout).
   */
  async hasOverduePayAfter(contactId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ overdue: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM bookings b JOIN booking_balances bb ON bb.booking_id = b.id
         WHERE b.contact_id = $1 AND b.payment_mode = 'pay_after' AND b.status = 'confirmed' AND bb.due_minor > 0
           AND b.original_slot_start <= now() - make_interval(days => $2)
       ) AS overdue`,
      [contactId, OVERDUE_LOCKOUT_DAYS],
    );
    return rows[0]?.overdue ?? false;
  }
}
