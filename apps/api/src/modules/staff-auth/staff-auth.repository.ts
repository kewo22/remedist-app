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

export interface StaffProfileRow {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  token_version: number;
  roles: Role[];
  permissions: Permission[];
}

/** Everything the access-token guard needs, from one query. */
export interface StaffAccessRow extends StaffProfileRow {
  session_revoked_at: Date | null;
  session_expires_at: Date;
}

const ROLES_AND_PERMISSIONS = `
  COALESCE(array_agg(DISTINCT r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles,
  COALESCE(array_agg(DISTINCT rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions`;

/** All SQL for staff logins. Sessions and the attempt ledger are in common/auth. */
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

  async findProfile(staffUserId: string): Promise<StaffProfileRow | undefined> {
    const { rows } = await this.db.query<StaffProfileRow>(
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

  /** Invalidates every outstanding access token for the login (sign-out-everywhere). */
  async bumpTokenVersion(staffUserId: string, db: Queryable = this.db): Promise<void> {
    await db.query('UPDATE auth.staff_users SET token_version = token_version + 1 WHERE id = $1', [staffUserId]);
  }
}
