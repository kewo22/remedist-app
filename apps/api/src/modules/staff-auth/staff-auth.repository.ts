import { Injectable } from '@nestjs/common';
import type { Permission, Role } from '@remedist/shared';
import { DatabaseService, Queryable } from '../../database/database.service';

export interface StaffLoginRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  token_version: number;
  roles: Role[];
}

export interface StaffSessionRow {
  id: string;
  staff_user_id: string;
  replaced_by: string | null;
  revoked_at: Date | null;
  expires_at: Date;
}

/** Everything the access-token guard needs, from one query. */
export interface StaffAccessRow {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  token_version: number;
  session_revoked_at: Date | null;
  session_expires_at: Date;
  roles: Role[];
  permissions: Permission[];
}

export interface NewSession {
  staffUserId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

const ROLES_AND_PERMISSIONS = `
  COALESCE(array_agg(DISTINCT r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles,
  COALESCE(array_agg(DISTINCT rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions`;

/** All SQL for staff logins, sessions and the login-attempt ledger. */
@Injectable()
export class StaffAuthRepository {
  constructor(private readonly db: DatabaseService) {}

  async findLoginByEmail(email: string): Promise<StaffLoginRow | undefined> {
    const { rows } = await this.db.query<StaffLoginRow>(
      `SELECT s.id, s.name, s.email, s.password_hash, s.is_active, s.token_version,
              COALESCE(array_agg(r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
       FROM auth.staff_users s
       LEFT JOIN auth.staff_user_roles r ON r.staff_user_id = s.id
       WHERE lower(s.email) = lower($1)
       GROUP BY s.id`,
      [email],
    );
    return rows[0];
  }

  async findAccess(staffUserId: string, sessionId: string): Promise<StaffAccessRow | undefined> {
    const { rows } = await this.db.query<StaffAccessRow>(
      `SELECT s.id, s.name, s.email, s.is_active, s.token_version,
              se.revoked_at AS session_revoked_at, se.expires_at AS session_expires_at,
              ${ROLES_AND_PERMISSIONS}
       FROM auth.sessions se
       JOIN auth.staff_users s ON s.id = se.staff_user_id
       LEFT JOIN auth.staff_user_roles r ON r.staff_user_id = s.id
       LEFT JOIN auth.role_permissions rp ON rp.role_code = r.role_code
       WHERE se.id = $1 AND s.id = $2
       GROUP BY s.id, se.id`,
      [sessionId, staffUserId],
    );
    return rows[0];
  }

  async findProfile(staffUserId: string): Promise<Omit<StaffAccessRow, 'session_revoked_at' | 'session_expires_at'> | undefined> {
    const { rows } = await this.db.query<Omit<StaffAccessRow, 'session_revoked_at' | 'session_expires_at'>>(
      `SELECT s.id, s.name, s.email, s.is_active, s.token_version, ${ROLES_AND_PERMISSIONS}
       FROM auth.staff_users s
       LEFT JOIN auth.staff_user_roles r ON r.staff_user_id = s.id
       LEFT JOIN auth.role_permissions rp ON rp.role_code = r.role_code
       WHERE s.id = $1
       GROUP BY s.id`,
      [staffUserId],
    );
    return rows[0];
  }

  async recordLogin(staffUserId: string): Promise<void> {
    await this.db.query('UPDATE auth.staff_users SET last_login_at = now() WHERE id = $1', [staffUserId]);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────────────────

  async createSession(session: NewSession, db: Queryable = this.db): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO auth.sessions (staff_user_id, refresh_token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5::inet)
       RETURNING id`,
      [session.staffUserId, session.refreshTokenHash, session.expiresAt, session.userAgent, session.ipAddress],
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('Session insert returned no id');
    }
    return id;
  }

  async findSessionByTokenHash(refreshTokenHash: string): Promise<StaffSessionRow | undefined> {
    const { rows } = await this.db.query<StaffSessionRow>(
      `SELECT id, staff_user_id, replaced_by, revoked_at, expires_at
       FROM auth.sessions
       WHERE refresh_token_hash = $1 AND staff_user_id IS NOT NULL`,
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

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.query('UPDATE auth.sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1', [sessionId]);
  }

  /** Ends every session for the login and invalidates its outstanding access tokens. */
  async revokeAllSessions(staffUserId: string, db: Queryable = this.db): Promise<number> {
    await db.query('UPDATE auth.staff_users SET token_version = token_version + 1 WHERE id = $1', [staffUserId]);
    const { rowCount } = await db.query(
      'UPDATE auth.sessions SET revoked_at = now() WHERE staff_user_id = $1 AND revoked_at IS NULL',
      [staffUserId],
    );
    return rowCount ?? 0;
  }

  // ── Login-attempt ledger ───────────────────────────────────────────────────────────────

  async recordFailedLogin(purpose: string, email: string | null, ipAddress: string | null): Promise<void> {
    await this.db.query('INSERT INTO auth.login_attempts (purpose, email, ip_address) VALUES ($1, $2, $3::inet)', [
      purpose,
      email,
      ipAddress,
    ]);
  }

  /**
   * Failures in a rolling window, and when the oldest of them falls out of it.
   * `field` is a fixed column name, never input.
   */
  async failuresInWindow(
    purpose: string,
    field: 'email' | 'ip_address',
    value: string,
    windowSeconds: number,
  ): Promise<{ count: number; oldest: Date | null }> {
    const column = field === 'email' ? 'lower(email)' : 'ip_address';
    const valueExpr = field === 'email' ? 'lower($2)' : '$2::inet';
    const { rows } = await this.db.query<{ count: number; oldest: Date | null }>(
      `SELECT count(*)::int AS count, min(created_at) AS oldest
       FROM auth.login_attempts
       WHERE purpose = $1 AND ${column} = ${valueExpr} AND created_at >= now() - make_interval(secs => $3)`,
      [purpose, value, windowSeconds],
    );
    return rows[0] ?? { count: 0, oldest: null };
  }
}
