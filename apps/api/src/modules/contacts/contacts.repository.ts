import { Global, Injectable, Module } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';

export type ContactSource = 'website' | 'walk_in' | 'probono' | 'staff' | 'import';

export interface FoundOrCreatedContact {
  id: string;
  created: boolean;
}

/**
 * Contact SQL needed before the contacts domain is built. Every public form funnels through
 * findOrCreateByEmail, so the CRM sees one contact per person.
 */
@Injectable()
export class ContactsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Finds the contact with this email (case-insensitive) or creates one. As in the old app, an
   * existing contact's name is updated until Part 1 registration locks it. A concurrent create
   * for the same email lands on the unique index and is merged instead of duplicated.
   */
  async findOrCreateByEmail(
    input: { name: string; email: string; source: ContactSource },
    db: Queryable = this.db,
  ): Promise<FoundOrCreatedContact> {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO contacts (name, email, source) VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) WHERE email IS NOT NULL DO NOTHING
       RETURNING id`,
      [input.name, input.email, input.source],
    );
    const createdId = inserted.rows[0]?.id;
    if (createdId) {
      return { id: createdId, created: true };
    }

    const { rows } = await db.query<{ id: string }>(
      `UPDATE contacts SET name = CASE WHEN part1_completed_at IS NULL THEN $2 ELSE name END
       WHERE lower(email) = lower($1)
       RETURNING id`,
      [input.email, input.name],
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('Contact conflict on email but no matching row');
    }
    return { id, created: false };
  }

  /** The name stays editable by the person until Part 1 registration locks it. */
  async renameUnlessLocked(contactId: string, name: string, db: Queryable = this.db): Promise<void> {
    await db.query('UPDATE contacts SET name = $2 WHERE id = $1 AND part1_completed_at IS NULL', [contactId, name]);
  }
}

@Global()
@Module({ providers: [ContactsRepository], exports: [ContactsRepository] })
export class ContactsModule {}
