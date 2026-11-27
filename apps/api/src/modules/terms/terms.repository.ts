import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';

export interface TermsRow {
  id: string;
  version_number: number | null;
  status: 'draft' | 'published';
  general_terms_content: string;
  refund_policy_content: string;
  published_at: Date | null;
  updated_at: Date;
}

export interface PublishedTermsRow extends TermsRow {
  version_number: number;
  published_at: Date;
  published_by_name: string | null;
}

const TERMS_COLUMNS = `t.id, t.version_number, t.status, t.general_terms_content, t.refund_policy_content,
  t.published_at, t.updated_at`;

/** All SQL for terms_versions. Contacts' consent columns are written by ContactsRepository. */
@Injectable()
export class TermsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findDraft(db: Queryable = this.db): Promise<TermsRow | undefined> {
    const { rows } = await db.query<TermsRow>(`SELECT ${TERMS_COLUMNS} FROM terms_versions t WHERE t.status = 'draft'`);
    return rows[0];
  }

  /** Locks the draft; undefined if a concurrent publish just turned it into a version. */
  async findDraftForUpdate(tx: Queryable): Promise<TermsRow | undefined> {
    const { rows } = await tx.query<TermsRow>(
      `SELECT ${TERMS_COLUMNS} FROM terms_versions t WHERE t.status = 'draft' FOR UPDATE`,
    );
    return rows[0];
  }

  /** Creates the draft unless one exists (exactly one may exist: terms_versions_one_draft). */
  async createDraftIfMissing(general: string, refund: string, db: Queryable = this.db): Promise<void> {
    await db.query(
      `INSERT INTO terms_versions (status, general_terms_content, refund_policy_content) VALUES ('draft', $1, $2)
       ON CONFLICT (status) WHERE status = 'draft' DO NOTHING`,
      [general, refund],
    );
  }

  async updateDraft(id: string, general: string, refund: string, tx: Queryable): Promise<void> {
    await tx.query(
      `UPDATE terms_versions SET general_terms_content = $2, refund_policy_content = $3 WHERE id = $1 AND status = 'draft'`,
      [id, general, refund],
    );
  }

  async latestVersionNumber(db: Queryable = this.db): Promise<number | null> {
    const { rows } = await db.query<{ version: number | null }>(
      `SELECT max(version_number) AS version FROM terms_versions WHERE status = 'published'`,
    );
    return rows[0]?.version ?? null;
  }

  async latestPublished(): Promise<PublishedTermsRow | undefined> {
    const { rows } = await this.db.query<PublishedTermsRow>(
      `SELECT ${TERMS_COLUMNS}, NULL AS published_by_name FROM terms_versions t
       WHERE t.status = 'published' ORDER BY t.version_number DESC LIMIT 1`,
    );
    return rows[0];
  }

  /** Freezes the draft as `version`. Published rows are never updated again. */
  async publish(id: string, version: number, staffUserId: string, tx: Queryable): Promise<void> {
    await tx.query(
      `UPDATE terms_versions SET status = 'published', version_number = $2, published_at = now(), published_by = $3
       WHERE id = $1 AND status = 'draft'`,
      [id, version, staffUserId],
    );
  }

  async listPublished(): Promise<PublishedTermsRow[]> {
    const { rows } = await this.db.query<PublishedTermsRow>(
      `SELECT ${TERMS_COLUMNS}, s.name AS published_by_name
       FROM terms_versions t LEFT JOIN auth.staff_users s ON s.id = t.published_by
       WHERE t.status = 'published' ORDER BY t.version_number DESC`,
    );
    return rows;
  }
}
