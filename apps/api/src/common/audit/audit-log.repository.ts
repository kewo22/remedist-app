import { Global, Injectable, Module } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';

export interface AuditEntry {
  actorType: 'staff' | 'patient' | 'system' | 'integration';
  /** staff_users.id or patient_accounts.id; omit for system and integration. */
  actorId?: string;
  /** Who, in words: a staff name, 'Google Calendar sync', 'Walk-in kiosk'. */
  actorLabel: string;
  /** dotted verb, e.g. 'slot.blocked', 'staff.signed_out_everywhere'. */
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
  requestId?: string;
  ipAddress?: string | null;
}

/** An audit_log row as history screens read it. */
export interface AuditRow {
  id: string;
  actor_type: AuditEntry['actorType'];
  actor_label: string;
  action: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  created_at: Date;
}

/** The one place that writes public.audit_log. Never put secrets or clinical text in it. */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly db: DatabaseService) {}

  /** The history of one entity type (optionally one entity), newest first. */
  async listForEntity(entityType: string, entityId: string | undefined, limit: number): Promise<AuditRow[]> {
    const { rows } = await this.db.query<AuditRow>(
      `SELECT id, actor_type, actor_label, action, entity_id, before, after, note, created_at
       FROM audit_log
       WHERE entity_type = $1 AND ($2::uuid IS NULL OR entity_id = $2)
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [entityType, entityId ?? null, limit],
    );
    return rows;
  }

  async record(entry: AuditEntry, db: Queryable = this.db): Promise<void> {
    await db.query(
      `INSERT INTO audit_log
         (actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after, note, request_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::inet)`,
      [
        entry.actorType,
        entry.actorId ?? null,
        entry.actorLabel,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.note ?? null,
        entry.requestId ?? null,
        entry.ipAddress ?? null,
      ],
    );
  }
}

@Global()
@Module({ providers: [AuditLogRepository], exports: [AuditLogRepository] })
export class AuditModule {}
