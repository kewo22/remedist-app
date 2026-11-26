import { Injectable } from '@nestjs/common';
import type { ClientAuthProvider } from '@remedist/shared';
import { DatabaseService, Queryable } from '../../database/database.service';

/** A portal account with its contact's name. */
export interface ClientAccountRow {
  id: string;
  contact_id: string;
  name: string;
  email: string;
  password_hash: string | null;
  google_id: string | null;
  auth_provider: ClientAuthProvider;
  email_verified_at: Date | null;
  token_version: number;
}

/** Everything the access-token guard needs, from one query. */
export interface ClientAccessRow {
  id: string;
  contact_id: string;
  email: string;
  token_version: number;
  session_revoked_at: Date | null;
  session_expires_at: Date;
}

const ACCOUNT_COLUMNS = `
  a.id, a.contact_id, c.name, a.email, a.password_hash, a.google_id, a.auth_provider,
  a.email_verified_at, a.token_version`;

/** All SQL for auth.patient_accounts. Sessions and the attempt ledger are in common/auth. */
@Injectable()
export class ClientAuthRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByEmail(email: string, db: Queryable = this.db): Promise<ClientAccountRow | undefined> {
    const { rows } = await db.query<ClientAccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM auth.patient_accounts a JOIN contacts c ON c.id = a.contact_id
       WHERE lower(a.email) = lower($1)`,
      [email],
    );
    return rows[0];
  }

  async findByGoogleId(googleId: string, db: Queryable = this.db): Promise<ClientAccountRow | undefined> {
    const { rows } = await db.query<ClientAccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM auth.patient_accounts a JOIN contacts c ON c.id = a.contact_id
       WHERE a.google_id = $1`,
      [googleId],
    );
    return rows[0];
  }

  async findById(accountId: string, db: Queryable = this.db): Promise<ClientAccountRow | undefined> {
    const { rows } = await db.query<ClientAccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM auth.patient_accounts a JOIN contacts c ON c.id = a.contact_id
       WHERE a.id = $1`,
      [accountId],
    );
    return rows[0];
  }

  async findAccess(accountId: string, sessionId: string): Promise<ClientAccessRow | undefined> {
    const { rows } = await this.db.query<ClientAccessRow>(
      `SELECT a.id, a.contact_id, a.email, a.token_version,
              se.revoked_at AS session_revoked_at, se.expires_at AS session_expires_at
       FROM auth.sessions se
       JOIN auth.patient_accounts a ON a.id = se.patient_account_id
       WHERE se.id = $1 AND a.id = $2`,
      [sessionId, accountId],
    );
    return rows[0];
  }

  /**
   * Creates an email-and-password account. Returns undefined if the email (or the contact) already
   * has one: a concurrent sign-up won the race.
   */
  async createWithPassword(
    input: { contactId: string; email: string; passwordHash: string },
    db: Queryable,
  ): Promise<string | undefined> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO auth.patient_accounts (contact_id, email, password_hash, auth_provider)
       VALUES ($1, $2, $3, 'email')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.contactId, input.email, input.passwordHash],
    );
    return rows[0]?.id;
  }

  /** A Google account is verified from the start. Undefined if a concurrent sign-in created it first. */
  async createWithGoogle(input: { contactId: string; email: string; googleId: string }, db: Queryable): Promise<string | undefined> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO auth.patient_accounts (contact_id, email, google_id, auth_provider, email_verified_at)
       VALUES ($1, $2, $3, 'google', now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.contactId, input.email, input.googleId],
    );
    return rows[0]?.id;
  }

  /** A retried sign-up before verification replaces the password. Never touches a verified account. */
  async replaceUnverifiedPassword(accountId: string, passwordHash: string, db: Queryable): Promise<void> {
    await db.query(
      `UPDATE auth.patient_accounts SET password_hash = $2
       WHERE id = $1 AND email_verified_at IS NULL`,
      [accountId, passwordHash],
    );
  }

  /** Conditional, so verifying twice is harmless. */
  async markEmailVerified(accountId: string): Promise<void> {
    await this.db.query(
      'UPDATE auth.patient_accounts SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
      [accountId],
    );
  }

  /**
   * Links Google to an existing account and marks the email verified (Google verified it).
   * `removePassword` drops a password nobody ever proved they own the email for.
   */
  async linkGoogle(accountId: string, googleId: string, removePassword: boolean, db: Queryable): Promise<void> {
    await db.query(
      `UPDATE auth.patient_accounts
       SET google_id = $2,
           auth_provider = 'google',
           email_verified_at = COALESCE(email_verified_at, now()),
           password_hash = CASE WHEN $3 THEN NULL ELSE password_hash END
       WHERE id = $1`,
      [accountId, googleId, removePassword],
    );
  }

  /** Sets a new password and invalidates every outstanding access token. */
  async resetPassword(accountId: string, passwordHash: string, db: Queryable): Promise<void> {
    await db.query(
      'UPDATE auth.patient_accounts SET password_hash = $2, token_version = token_version + 1 WHERE id = $1',
      [accountId, passwordHash],
    );
  }

  async bumpTokenVersion(accountId: string, db: Queryable = this.db): Promise<void> {
    await db.query('UPDATE auth.patient_accounts SET token_version = token_version + 1 WHERE id = $1', [accountId]);
  }

  async recordLogin(accountId: string): Promise<void> {
    await this.db.query('UPDATE auth.patient_accounts SET last_login_at = now() WHERE id = $1', [accountId]);
  }
}
