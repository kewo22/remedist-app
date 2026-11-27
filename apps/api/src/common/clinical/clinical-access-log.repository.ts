import { Global, Injectable, Module } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';

export interface ClinicalAccessEntry {
  staffUserId: string;
  contactId: string;
  action: 'view' | 'edit' | 'sign' | 'export';
  /** What was opened, e.g. 'intake_form', 'intake_photo', 'intake_form_list'. */
  entityType: string;
  entityId?: string;
  requestId?: string;
  ipAddress?: string | null;
}

/**
 * The one place that writes clinical.access_log: which staff member read or changed which
 * patient's clinical record. Write it for every staff read and write of clinical data, super_admin
 * included. Rows can't be changed or removed once written.
 */
@Injectable()
export class ClinicalAccessLogRepository {
  constructor(private readonly db: DatabaseService) {}

  async record(entry: ClinicalAccessEntry, db: Queryable = this.db): Promise<void> {
    await db.query(
      `INSERT INTO clinical.access_log (staff_user_id, contact_id, action, entity_type, entity_id, request_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet)`,
      [
        entry.staffUserId,
        entry.contactId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.requestId ?? null,
        entry.ipAddress ?? null,
      ],
    );
  }
}

@Global()
@Module({ providers: [ClinicalAccessLogRepository], exports: [ClinicalAccessLogRepository] })
export class ClinicalAccessLogModule {}
