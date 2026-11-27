import { Injectable } from '@nestjs/common';
import type {
  ClientListSortField,
  ContactGender,
  ContactSource,
  ContactStage,
  DependentRelationship,
  IdType,
} from '@remedist/shared';
import { DatabaseService, Queryable } from '../../database/database.service';

export type { ContactSource } from '@remedist/shared';

export interface FoundOrCreatedContact {
  id: string;
  created: boolean;
}

/** A contacts row as the API reads it. date_of_birth comes back as "YYYY-MM-DD" text. */
export interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  residency: 'lk' | 'intl';
  source: ContactSource;
  stage: ContactStage;
  registration_number: string | null;
  gender: ContactGender | null;
  nationality: string | null;
  id_type: IdType | null;
  id_number: string | null;
  date_of_birth: string | null;
  profession: string | null;
  address: string | null;
  backup_contact_name: string | null;
  backup_contact_relation: string | null;
  backup_contact_phone: string | null;
  referral_text: string | null;
  referred_by_contact_id: string | null;
  terms_accepted_at: Date | null;
  terms_accepted_version: number | null;
  part1_completed_at: Date | null;
  pay_after_session: boolean;
  reminder_frequency_days: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContactListRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  registration_number: string | null;
  stage: ContactStage;
  source: ContactSource;
  has_account: boolean;
  pay_after_session: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContactLookupRow {
  id: string;
  name: string;
  registration_number: string | null;
}

export interface DependentRow extends ContactLookupRow {
  relationship: DependentRelationship;
  part1_completed_at: Date | null;
}

export interface AccountSummaryRow {
  email: string;
  auth_provider: 'email' | 'google';
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

export interface IdentityCorrectionRow {
  created_at: Date;
  actor_label: string;
  before: Record<string, string | null> | null;
  after: Record<string, string | null> | null;
  note: string | null;
}

/**
 * The contact columns callers may write through `update`, by column name. Anything else (the
 * registration number, Part 1 completion, archiving) has its own method or isn't written here.
 */
export interface ContactUpdate {
  name?: string;
  email?: string | null;
  phone?: string | null;
  stage?: ContactStage;
  gender?: ContactGender;
  nationality?: string;
  residency?: 'lk' | 'intl';
  id_type?: IdType | null;
  id_number?: string | null;
  date_of_birth?: string;
  profession?: string | null;
  address?: string | null;
  backup_contact_name?: string | null;
  backup_contact_relation?: string | null;
  backup_contact_phone?: string | null;
  referred_by_contact_id?: string | null;
  pay_after_session?: boolean;
  reminder_frequency_days?: number;
}

/** Everything Part 1 writes. Undefined `email` or `phone` keeps the value on file. */
export interface Part1Fields {
  name: string;
  gender: ContactGender;
  nationality: string;
  residency: 'lk' | 'intl';
  id_type: IdType | null;
  id_number: string | null;
  date_of_birth: string;
  email?: string | null;
  phone?: string | null;
  profession: string | null;
  address: string | null;
  backup_contact_name: string | null;
  backup_contact_relation: string | null;
  backup_contact_phone: string | null;
  referral_text: string | null;
  /** Null only when no terms have been published yet. */
  terms_accepted_version: number | null;
}

const UPDATABLE_COLUMNS: ReadonlySet<string> = new Set<keyof ContactUpdate>([
  'name',
  'email',
  'phone',
  'stage',
  'gender',
  'nationality',
  'residency',
  'id_type',
  'id_number',
  'date_of_birth',
  'profession',
  'address',
  'backup_contact_name',
  'backup_contact_relation',
  'backup_contact_phone',
  'referred_by_contact_id',
  'pay_after_session',
  'reminder_frequency_days',
]);

const CONTACT_COLUMNS = `
  c.id, c.name, c.phone, c.email, c.residency, c.source, c.stage, c.registration_number, c.gender,
  c.nationality, c.id_type, c.id_number, to_char(c.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
  c.profession, c.address, c.backup_contact_name, c.backup_contact_relation, c.backup_contact_phone,
  c.referral_text, c.referred_by_contact_id, c.terms_accepted_at, c.terms_accepted_version,
  c.part1_completed_at, c.pay_after_session, c.reminder_frequency_days, c.archived_at, c.created_at,
  c.updated_at`;

const SORT_COLUMNS: Record<ClientListSortField, string> = {
  updatedAt: 'c.updated_at',
  createdAt: 'c.created_at',
  name: 'lower(c.name)',
  registrationNumber: 'c.registration_number',
};

/** Unique index names, for isUniqueViolation. */
export const CONTACT_EMAIL_INDEX = 'contacts_email_key';
export const CONTACT_ID_NUMBER_INDEX = 'contacts_id_number_key';

/** Escapes LIKE wildcards so a search for "50%" or "a_b" matches literally. */
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export interface ContactListFilter {
  q?: string;
  stage?: ContactStage;
  includeArchived: boolean;
  sortBy: ClientListSortField;
  sortDir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** All SQL for contacts and account_dependents. */
@Injectable()
export class ContactsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Public forms ───────────────────────────────────────────────────────────────────────

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

  // ── One contact ────────────────────────────────────────────────────────────────────────

  async findById(id: string, db: Queryable = this.db): Promise<ContactRow | undefined> {
    const { rows } = await db.query<ContactRow>(`SELECT ${CONTACT_COLUMNS} FROM contacts c WHERE c.id = $1`, [id]);
    return rows[0];
  }

  /** Locks the row for the rest of the transaction, so two edits can't interleave their before/after. */
  async findByIdForUpdate(id: string, tx: Queryable): Promise<ContactRow | undefined> {
    const { rows } = await tx.query<ContactRow>(`SELECT ${CONTACT_COLUMNS} FROM contacts c WHERE c.id = $1 FOR UPDATE`, [
      id,
    ]);
    return rows[0];
  }

  /** Writes the given columns (only those in ContactUpdate). Undefined values are skipped. */
  async update(id: string, changes: ContactUpdate, db: Queryable = this.db): Promise<void> {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return;
    }
    for (const [column] of entries) {
      if (!UPDATABLE_COLUMNS.has(column)) {
        throw new Error(`Column ${column} can't be updated through ContactsRepository.update`);
      }
    }
    const assignments = entries.map(([column], index) => `${column} = $${index + 2}`).join(', ');
    await db.query(`UPDATE contacts SET ${assignments} WHERE id = $1`, [id, ...entries.map(([, value]) => value)]);
  }

  async emailTakenByAnother(email: string, contactId: string, db: Queryable = this.db): Promise<boolean> {
    const { rows } = await db.query<{ taken: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM contacts WHERE lower(email) = lower($1) AND id <> $2) AS taken',
      [email, contactId],
    );
    return rows[0]?.taken ?? false;
  }

  async idNumberTakenByAnother(idNumber: string, contactId: string, db: Queryable = this.db): Promise<boolean> {
    const { rows } = await db.query<{ taken: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM contacts WHERE id_number = $1 AND id <> $2) AS taken',
      [idNumber, contactId],
    );
    return rows[0]?.taken ?? false;
  }

  // ── Registration numbers ──────────────────────────────────────────────────────────────

  /**
   * Draws the next registration sequence value. One upsert, so concurrent calls never get the
   * same value; a value drawn by a call that then loses a race is skipped (a gap is acceptable).
   */
  async nextRegistrationSequence(tx: Queryable): Promise<number> {
    const { rows } = await tx.query<{ assigned: number }>(
      `INSERT INTO sequence_counters AS sc (name, next_value) VALUES ('registration_number', 2)
       ON CONFLICT (name) DO UPDATE SET next_value = sc.next_value + 1
       RETURNING sc.next_value - 1 AS assigned`,
    );
    const assigned = rows[0]?.assigned;
    if (assigned === undefined) {
      throw new Error('sequence_counters upsert returned no row');
    }
    return assigned;
  }

  /** Sets the number only if the contact has none. Returns the number the contact ends up with. */
  async setRegistrationNumberIfUnset(contactId: string, registrationNumber: string, tx: Queryable): Promise<string | null> {
    const { rows } = await tx.query<{ registration_number: string | null }>(
      `WITH updated AS (
         UPDATE contacts SET registration_number = $2 WHERE id = $1 AND registration_number IS NULL
         RETURNING registration_number
       )
       SELECT registration_number FROM updated
       UNION ALL
       SELECT registration_number FROM contacts WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM updated)`,
      [contactId, registrationNumber],
    );
    return rows[0]?.registration_number ?? null;
  }

  // ── Part 1 registration and consent ───────────────────────────────────────────────────

  /**
   * Writes Part 1 and marks it complete, recording consent (timestamped, with the version shown, if
   * any was published). Only while Part 1 is incomplete: false if it was already done. `email` and
   * `phone` left undefined keep their value.
   */
  async completePart1(id: string, fields: Part1Fields, tx: Queryable): Promise<boolean> {
    const result = await tx.query(
      `UPDATE contacts SET
         name = $2, gender = $3, nationality = $4, residency = $5, id_type = $6, id_number = $7,
         date_of_birth = $8,
         email = CASE WHEN $9 THEN $10 ELSE email END,
         phone = CASE WHEN $11 THEN $12 ELSE phone END,
         profession = $13, address = $14, backup_contact_name = $15, backup_contact_relation = $16,
         backup_contact_phone = $17, referral_text = $18,
         terms_accepted_at = now(), terms_accepted_version = $19, part1_completed_at = now()
       WHERE id = $1 AND part1_completed_at IS NULL`,
      [
        id,
        fields.name,
        fields.gender,
        fields.nationality,
        fields.residency,
        fields.id_type,
        fields.id_number,
        fields.date_of_birth,
        fields.email !== undefined,
        fields.email ?? null,
        fields.phone !== undefined,
        fields.phone ?? null,
        fields.profession,
        fields.address,
        fields.backup_contact_name,
        fields.backup_contact_relation,
        fields.backup_contact_phone,
        fields.referral_text,
        fields.terms_accepted_version,
      ],
    );
    return result.rowCount === 1;
  }

  /** Records acceptance of a published terms version, now. */
  async setTermsAccepted(id: string, version: number, tx: Queryable): Promise<void> {
    await tx.query('UPDATE contacts SET terms_accepted_at = now(), terms_accepted_version = $2 WHERE id = $1', [id, version]);
  }

  /** The most common nationalities on file, most common first (ties alphabetically). */
  async topNationalities(limit: number): Promise<string[]> {
    const { rows } = await this.db.query<{ nationality: string }>(
      `SELECT nationality FROM contacts
       WHERE nationality IS NOT NULL AND archived_at IS NULL
       GROUP BY nationality ORDER BY count(*) DESC, nationality
       LIMIT $1`,
      [limit],
    );
    return rows.map((row) => row.nationality);
  }

  // ── Portal: own contact and dependents ────────────────────────────────────────────────

  /**
   * The contact if it's the account's own or one of its dependents, with which of the two.
   * Undefined for anyone else's contact.
   */
  async findOwned(
    accountId: string,
    accountContactId: string,
    contactId: string,
  ): Promise<{ contact: ContactRow; isDependent: boolean } | undefined> {
    const { rows } = await this.db.query<ContactRow & { is_dependent: boolean }>(
      `SELECT ${CONTACT_COLUMNS}, (c.id <> $2) AS is_dependent
       FROM contacts c
       WHERE c.id = $3
         AND (c.id = $2 OR EXISTS (
           SELECT 1 FROM account_dependents d WHERE d.patient_account_id = $1 AND d.contact_id = c.id))`,
      [accountId, accountContactId, contactId],
    );
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    const { is_dependent: isDependent, ...contact } = row;
    return { contact, isDependent };
  }

  async listDependents(accountId: string): Promise<DependentRow[]> {
    const { rows } = await this.db.query<DependentRow>(
      `SELECT c.id, c.name, c.registration_number, d.relationship, c.part1_completed_at
       FROM account_dependents d JOIN contacts c ON c.id = d.contact_id
       WHERE d.patient_account_id = $1 AND c.archived_at IS NULL
       ORDER BY d.created_at, c.name`,
      [accountId],
    );
    return rows;
  }

  /** A bare contact (no email: it's the account holder's) linked to the account. */
  async createDependent(
    accountId: string,
    input: { name: string; relationship: DependentRelationship },
    tx: Queryable,
  ): Promise<DependentRow> {
    const { rows } = await tx.query<{ id: string }>(`INSERT INTO contacts (name, source) VALUES ($1, 'website') RETURNING id`, [
      input.name,
    ]);
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('Contact insert returned no id');
    }
    await tx.query('INSERT INTO account_dependents (patient_account_id, contact_id, relationship) VALUES ($1, $2, $3)', [
      accountId,
      id,
      input.relationship,
    ]);
    return { id, name: input.name, registration_number: null, relationship: input.relationship, part1_completed_at: null };
  }

  // ── CRM ────────────────────────────────────────────────────────────────────────────────

  /** One page of contacts, plus the total matching. */
  async list(filter: ContactListFilter): Promise<{ rows: ContactListRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const param = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (!filter.includeArchived) {
      where.push('c.archived_at IS NULL');
    }
    if (filter.stage) {
      where.push(`c.stage = ${param(filter.stage)}`);
    }
    const q = filter.q?.trim();
    if (q) {
      const like = param(likeContains(q));
      const matches = [`c.name ILIKE ${like}`, `c.email ILIKE ${like}`, `c.registration_number ILIKE ${like}`, `c.id_number ILIKE ${like}`];
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 3) {
        matches.push(`c.phone LIKE ${param(likeContains(digits))}`);
      }
      where.push(`(${matches.join(' OR ')})`);
    }

    const direction = filter.sortDir === 'asc' ? 'ASC' : 'DESC';
    // Contacts without a registration number sort last either way; id breaks ties so pages are stable.
    const order = `${SORT_COLUMNS[filter.sortBy]} ${direction} NULLS LAST, c.id`;
    const { rows } = await this.db.query<ContactListRow & { total: string }>(
      `SELECT c.id, c.name, c.email, c.phone, c.registration_number, c.stage, c.source,
              EXISTS (SELECT 1 FROM auth.patient_accounts a WHERE a.contact_id = c.id) AS has_account,
              c.pay_after_session, c.archived_at, c.created_at, c.updated_at,
              count(*) OVER () AS total
       FROM contacts c
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${order}
       LIMIT ${param(filter.limit)} OFFSET ${param(filter.offset)}`,
      params,
    );
    const total = rows[0] ? Number(rows[0].total) : await this.count(where, params.slice(0, -2));
    return { rows: rows.map(({ total: _total, ...row }) => row), total };
  }

  /** The total when the requested page is past the end (so the window count isn't available). */
  private async count(where: string[], params: unknown[]): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM contacts c ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`,
      params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Name or registration number contains `q`; for pickers. */
  async lookup(q: string, limit: number, excludeId?: string): Promise<ContactLookupRow[]> {
    const { rows } = await this.db.query<ContactLookupRow>(
      `SELECT id, name, registration_number FROM contacts
       WHERE archived_at IS NULL AND (name ILIKE $1 OR registration_number ILIKE $1)
         AND ($3::uuid IS NULL OR id <> $3)
       ORDER BY lower(name), id
       LIMIT $2`,
      [likeContains(q), limit, excludeId ?? null],
    );
    return rows;
  }

  async findLookup(id: string, db: Queryable = this.db): Promise<ContactLookupRow | undefined> {
    const { rows } = await db.query<ContactLookupRow>('SELECT id, name, registration_number FROM contacts WHERE id = $1', [
      id,
    ]);
    return rows[0];
  }

  /** Contacts whose name contains any of the words, with how many words matched, best first. */
  async matchNameWords(words: string[], excludeId: string, limit: number): Promise<ContactLookupRow[]> {
    const { rows } = await this.db.query<ContactLookupRow>(
      `SELECT c.id, c.name, c.registration_number
       FROM contacts c
       CROSS JOIN LATERAL (
         SELECT count(*) AS hits FROM unnest($1::text[]) AS w(pattern) WHERE c.name ILIKE w.pattern
       ) m
       WHERE c.id <> $2 AND c.archived_at IS NULL AND m.hits > 0
       ORDER BY m.hits DESC, lower(c.name), c.id
       LIMIT $3`,
      [words.map(likeContains), excludeId, limit],
    );
    return rows;
  }

  async accountSummary(contactId: string): Promise<AccountSummaryRow | undefined> {
    const { rows } = await this.db.query<AccountSummaryRow>(
      `SELECT email, auth_provider, email_verified_at, last_login_at, created_at
       FROM auth.patient_accounts WHERE contact_id = $1`,
      [contactId],
    );
    return rows[0];
  }

  async hasAccount(contactId: string, db: Queryable = this.db): Promise<boolean> {
    const { rows } = await db.query<{ has: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM auth.patient_accounts WHERE contact_id = $1) AS has',
      [contactId],
    );
    return rows[0]?.has ?? false;
  }

  /** The account holder's contact, when this contact is someone's dependent. */
  async managedBy(contactId: string): Promise<ContactLookupRow | undefined> {
    const { rows } = await this.db.query<ContactLookupRow>(
      `SELECT h.id, h.name, h.registration_number
       FROM account_dependents d
       JOIN auth.patient_accounts a ON a.id = d.patient_account_id
       JOIN contacts h ON h.id = a.contact_id
       WHERE d.contact_id = $1
       ORDER BY d.created_at
       LIMIT 1`,
      [contactId],
    );
    return rows[0];
  }

  /** The dependents managed by this contact's account. */
  async dependentsOfContact(contactId: string): Promise<DependentRow[]> {
    const { rows } = await this.db.query<DependentRow>(
      `SELECT c.id, c.name, c.registration_number, d.relationship, c.part1_completed_at
       FROM auth.patient_accounts a
       JOIN account_dependents d ON d.patient_account_id = a.id
       JOIN contacts c ON c.id = d.contact_id
       WHERE a.contact_id = $1
       ORDER BY d.created_at, c.name`,
      [contactId],
    );
    return rows;
  }

  /** Strikes are never stored as a count. */
  async strikeCount(contactId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM contact_strikes WHERE contact_id = $1', [
      contactId,
    ]);
    return Number(rows[0]?.n ?? 0);
  }

  async identityCorrections(contactId: string, action: string, limit: number): Promise<IdentityCorrectionRow[]> {
    const { rows } = await this.db.query<IdentityCorrectionRow>(
      `SELECT created_at, actor_label, before, after, note
       FROM audit_log
       WHERE entity_type = 'contact' AND entity_id = $1 AND action = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [contactId, action, limit],
    );
    return rows;
  }
}
