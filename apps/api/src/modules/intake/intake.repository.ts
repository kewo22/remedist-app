import { Injectable } from '@nestjs/common';
import {
  INTAKE_FORM_VERSION,
  type AnatomyCategory,
  type IntakeAnswers,
  type IntakeCompletedVia,
  type IntakePainPointInput,
  type IntakePhotoContentType,
  type IntakeStatus,
  type PosturePhotoSide,
} from '@remedist/shared';
import { DatabaseService, Queryable } from '../../database/database.service';

export interface AnatomySegmentRow {
  id: string;
  category: AnatomyCategory;
  name: string;
  display_order: number;
}

/** An intake form with its booking's session start (null for pro-bono before a slot). */
export interface IntakeFormRow {
  id: string;
  contact_id: string;
  booking_id: string | null;
  probono_entry_id: string | null;
  form_version: number;
  /** '{}' until first submitted. */
  answers: IntakeAnswers | Record<string, never>;
  pain_points: IntakePainPointInput[] | null;
  problem_description: string | null;
  status: IntakeStatus;
  completed_at: Date | null;
  completed_via: IntakeCompletedVia | null;
  session_start: Date | null;
  /** The booking's channel; a walk-in's form is completed on the clinic tablet. */
  booked_via: 'online' | 'staff' | 'walk_in' | null;
}

export interface IntakePhotoRow {
  id: string;
  side: PosturePhotoSide;
  storage_key: string;
  content_type: IntakePhotoContentType;
  size_bytes: number;
  created_at: Date;
}

export interface IntakeSubmission {
  answers: IntakeAnswers;
  painPoints: IntakePainPointInput[];
  problemDescription: string | null;
}

const FORM_COLUMNS = `f.id, f.contact_id, f.booking_id, f.probono_entry_id, f.form_version, f.answers, f.pain_points,
  f.problem_description, f.status, f.completed_at, f.completed_via, b.slot_start AS session_start, b.booked_via`;

const FORM_FROM = 'clinical.intake_forms f LEFT JOIN bookings b ON b.id = f.booking_id';

/** Posture photos are attachments of kind posture_<side>. */
const PHOTO_COLUMNS = `a.id, substring(a.kind from 9) AS side, a.storage_key, a.content_type, a.size_bytes, a.created_at`;

/** All SQL for Part 2: clinical.intake_forms, their posture photos and the anatomy reference list. */
@Injectable()
export class IntakeRepository {
  constructor(private readonly db: DatabaseService) {}

  async anatomySegments(): Promise<AnatomySegmentRow[]> {
    const { rows } = await this.db.query<AnatomySegmentRow>(
      `SELECT id, category, name, display_order FROM anatomy_segments
       ORDER BY CASE category WHEN 'head' THEN 1 WHEN 'frontside' THEN 2 WHEN 'backside' THEN 3 ELSE 4 END, display_order`,
    );
    return rows;
  }

  // ── Forms ──────────────────────────────────────────────────────────────────────────────

  /** A contact's forms, newest session first. Forms for cancelled bookings are left out. */
  async listForContact(contactId: string): Promise<IntakeFormRow[]> {
    const { rows } = await this.db.query<IntakeFormRow>(
      `SELECT ${FORM_COLUMNS} FROM ${FORM_FROM}
       WHERE f.contact_id = $1 AND (b.id IS NULL OR b.status <> 'cancelled')
       ORDER BY COALESCE(b.slot_start, f.created_at) DESC`,
      [contactId],
    );
    return rows;
  }

  async findById(id: string, db: Queryable = this.db): Promise<IntakeFormRow | undefined> {
    const { rows } = await db.query<IntakeFormRow>(`SELECT ${FORM_COLUMNS} FROM ${FORM_FROM} WHERE f.id = $1`, [id]);
    return rows[0];
  }

  /** Locks the form for the rest of the transaction. */
  async findByIdForUpdate(id: string, tx: Queryable): Promise<IntakeFormRow | undefined> {
    const { rows } = await tx.query<IntakeFormRow>(`SELECT ${FORM_COLUMNS} FROM ${FORM_FROM} WHERE f.id = $1 FOR UPDATE OF f`, [id]);
    return rows[0];
  }

  /** The contact's most recent completed form on the current question set, for prefilling. */
  async lastCompleted(contactId: string): Promise<IntakeFormRow | undefined> {
    const { rows } = await this.db.query<IntakeFormRow>(
      `SELECT ${FORM_COLUMNS} FROM ${FORM_FROM}
       WHERE f.contact_id = $1 AND f.status = 'completed' AND f.form_version = $2
       ORDER BY f.completed_at DESC LIMIT 1`,
      [contactId, INTAKE_FORM_VERSION],
    );
    return rows[0];
  }

  /**
   * Saves the answers and marks the form completed. The first completion's time and channel are
   * kept when it's edited later, as in the old app.
   */
  async submit(id: string, submission: IntakeSubmission, via: IntakeCompletedVia, tx: Queryable): Promise<void> {
    await tx.query(
      `UPDATE clinical.intake_forms
       SET form_version = $2, answers = $3, pain_points = $4, problem_description = $5, status = 'completed',
           completed_at = COALESCE(completed_at, now()), completed_via = COALESCE(completed_via, $6)
       WHERE id = $1`,
      [
        id,
        INTAKE_FORM_VERSION,
        JSON.stringify(submission.answers),
        JSON.stringify(submission.painPoints),
        submission.problemDescription,
        via,
      ],
    );
  }

  /** A completed Part 2 moves a pending pro-bono application onto the waiting list (PRD C.4.9). */
  async waitlistProbonoEntry(probonoEntryId: string, tx: Queryable): Promise<boolean> {
    const result = await tx.query(
      `UPDATE probono_entries SET status = 'waitlisted', part2_completed_at = now() WHERE id = $1 AND status = 'pending'`,
      [probonoEntryId],
    );
    return result.rowCount === 1;
  }

  // ── Drafts, created by booking and pro-bono ───────────────────────────────────────────

  /** The pending form for a booking. Idempotent: returns the existing one if there is one. */
  async createForBooking(contactId: string, bookingId: string, tx: Queryable): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `WITH inserted AS (
         INSERT INTO clinical.intake_forms (contact_id, booking_id, form_version) VALUES ($1, $2, $3)
         ON CONFLICT (booking_id) DO NOTHING RETURNING id
       )
       SELECT id FROM inserted UNION ALL SELECT id FROM clinical.intake_forms WHERE booking_id = $2`,
      [contactId, bookingId, INTAKE_FORM_VERSION],
    );
    return this.requireId(rows[0]?.id);
  }

  /** The pending form for a pro-bono application, before it has a booking. Idempotent. */
  async createForProbonoEntry(contactId: string, probonoEntryId: string, tx: Queryable): Promise<string> {
    const existing = await tx.query<{ id: string }>('SELECT id FROM clinical.intake_forms WHERE probono_entry_id = $1', [
      probonoEntryId,
    ]);
    if (existing.rows[0]) {
      return existing.rows[0].id;
    }
    const { rows } = await tx.query<{ id: string }>(
      'INSERT INTO clinical.intake_forms (contact_id, probono_entry_id, form_version) VALUES ($1, $2, $3) RETURNING id',
      [contactId, probonoEntryId, INTAKE_FORM_VERSION],
    );
    return this.requireId(rows[0]?.id);
  }

  /** When a pro-bono application gets a slot, its form follows it to the booking. */
  async attachProbonoFormToBooking(probonoEntryId: string, bookingId: string, tx: Queryable): Promise<void> {
    await tx.query('UPDATE clinical.intake_forms SET booking_id = $2 WHERE probono_entry_id = $1 AND booking_id IS NULL', [
      probonoEntryId,
      bookingId,
    ]);
  }

  // ── Photos ─────────────────────────────────────────────────────────────────────────────

  async photos(intakeId: string): Promise<IntakePhotoRow[]> {
    const { rows } = await this.db.query<IntakePhotoRow>(
      `SELECT ${PHOTO_COLUMNS} FROM clinical.attachments a
       WHERE a.intake_id = $1 AND a.kind LIKE 'posture\\_%'
       ORDER BY array_position(ARRAY['posture_front', 'posture_back', 'posture_left', 'posture_right'], a.kind)`,
      [intakeId],
    );
    return rows;
  }

  async findPhoto(intakeId: string, side: PosturePhotoSide): Promise<IntakePhotoRow | undefined> {
    const { rows } = await this.db.query<IntakePhotoRow>(
      `SELECT ${PHOTO_COLUMNS} FROM clinical.attachments a WHERE a.intake_id = $1 AND a.kind = $2`,
      [intakeId, `posture_${side}`],
    );
    return rows[0];
  }

  /**
   * Records the photo for one side, replacing the earlier one's row. The earlier file stays in
   * storage: clinical files are never deleted.
   */
  async savePhoto(
    input: {
      contactId: string;
      intakeId: string;
      side: PosturePhotoSide;
      storageKey: string;
      contentType: IntakePhotoContentType;
      sizeBytes: number;
      uploadedBy: string | null;
    },
    tx: Queryable,
  ): Promise<{ row: IntakePhotoRow; replacedKey: string | null }> {
    const previous = await tx.query<{ storage_key: string }>(
      'SELECT storage_key FROM clinical.attachments WHERE intake_id = $1 AND kind = $2 FOR UPDATE',
      [input.intakeId, `posture_${input.side}`],
    );
    const { rows } = await tx.query<IntakePhotoRow>(
      `INSERT INTO clinical.attachments AS a (contact_id, intake_id, kind, storage_key, content_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (intake_id, kind) WHERE intake_id IS NOT NULL AND kind LIKE 'posture_%'
       DO UPDATE SET storage_key = EXCLUDED.storage_key, content_type = EXCLUDED.content_type,
                     size_bytes = EXCLUDED.size_bytes, uploaded_by = EXCLUDED.uploaded_by, created_at = now()
       RETURNING ${PHOTO_COLUMNS}`,
      [
        input.contactId,
        input.intakeId,
        `posture_${input.side}`,
        input.storageKey,
        input.contentType,
        input.sizeBytes,
        input.uploadedBy,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Photo upsert returned no row');
    }
    return { row, replacedKey: previous.rows[0]?.storage_key ?? null };
  }

  private requireId(id: string | undefined): string {
    if (!id) {
      throw new Error('Intake form insert returned no id');
    }
    return id;
  }
}
