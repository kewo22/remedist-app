import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';

/** Whose session it is. Each auth.sessions row belongs to exactly one staff login or client account. */
export type SessionOwnerKind = 'staff' | 'patient';

/** Fixed column names per owner kind: never built from input. */
const OWNER_COLUMN: Record<SessionOwnerKind, 'staff_user_id' | 'patient_account_id'> = {
  staff: 'staff_user_id',
  patient: 'patient_account_id',
};

export interface SessionRow {
  id: string;
  owner_id: string;
  replaced_by: string | null;
  revoked_at: Date | null;
  expires_at: Date;
}

export interface NewSession {
  ownerKind: SessionOwnerKind;
  ownerId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

/** All SQL for auth.sessions (refresh-token sessions, staff and client). */
@Injectable()
export class SessionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(session: NewSession, db: Queryable = this.db): Promise<string> {
    const column = OWNER_COLUMN[session.ownerKind];
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO auth.sessions (${column}, refresh_token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5::inet)
       RETURNING id`,
      [session.ownerId, session.refreshTokenHash, session.expiresAt, session.userAgent, session.ipAddress],
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('Session insert returned no id');
    }
    return id;
  }

  /** Only finds sessions of the given kind, so a staff cookie can't refresh a client session. */
  async findByTokenHash(ownerKind: SessionOwnerKind, refreshTokenHash: string): Promise<SessionRow | undefined> {
    const column = OWNER_COLUMN[ownerKind];
    const { rows } = await this.db.query<SessionRow>(
      `SELECT id, ${column} AS owner_id, replaced_by, revoked_at, expires_at
       FROM auth.sessions
       WHERE refresh_token_hash = $1 AND ${column} IS NOT NULL`,
      [refreshTokenHash],
    );
    return rows[0];
  }

  /**
   * Marks an active session as replaced (and revoked) by its successor. Conditional, so two
   * concurrent refreshes can't both rotate the same session: returns false if it lost the race.
   */
  async markRotated(sessionId: string, replacedBy: string, db: Queryable): Promise<boolean> {
    const { rowCount } = await db.query(
      `UPDATE auth.sessions
       SET replaced_by = $2, revoked_at = now(), last_used_at = now()
       WHERE id = $1 AND replaced_by IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [sessionId, replacedBy],
    );
    return rowCount === 1;
  }

  /** Revokes a session and every session it was rotated into (reuse of a stolen token). */
  async revokeChainFrom(sessionId: string): Promise<void> {
    await this.db.query(
      `WITH RECURSIVE chain AS (
         SELECT id, replaced_by FROM auth.sessions WHERE id = $1
         UNION ALL
         SELECT s.id, s.replaced_by FROM auth.sessions s JOIN chain c ON s.id = c.replaced_by
       )
       UPDATE auth.sessions SET revoked_at = COALESCE(revoked_at, now())
       WHERE id IN (SELECT id FROM chain)`,
      [sessionId],
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.query('UPDATE auth.sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1', [sessionId]);
  }

  /** Ends every active session of one owner. Returns how many were ended. */
  async revokeAllFor(ownerKind: SessionOwnerKind, ownerId: string, db: Queryable = this.db): Promise<number> {
    const column = OWNER_COLUMN[ownerKind];
    const { rowCount } = await db.query(
      `UPDATE auth.sessions SET revoked_at = now() WHERE ${column} = $1 AND revoked_at IS NULL`,
      [ownerId],
    );
    return rowCount ?? 0;
  }
}
