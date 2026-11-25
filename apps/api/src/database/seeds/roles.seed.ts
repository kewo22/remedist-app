import { ROLE_DEFINITIONS, Role } from '@remedist/shared';
import type { Queryable } from '../database.service';
import type { SeedReport } from './seed-report';

/**
 * Makes auth.roles and auth.role_permissions match ROLE_DEFINITIONS in packages/shared.
 * Unlike starting data this is a sync: code is the source of truth, so it runs every time and
 * removes permissions that were taken out of the code.
 */
export async function syncRolesAndPermissions(db: Queryable, report: SeedReport): Promise<void> {
  for (const [code, role] of Object.entries(ROLE_DEFINITIONS) as [Role, (typeof ROLE_DEFINITIONS)[Role]][]) {
    await db.query(
      `INSERT INTO auth.roles (code, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [code, role.name, role.description],
    );
    await db.query('DELETE FROM auth.role_permissions WHERE role_code = $1 AND NOT (permission = ANY($2::text[]))', [
      code,
      role.permissions,
    ]);
    await db.query(
      `INSERT INTO auth.role_permissions (role_code, permission)
       SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [code, role.permissions],
    );
  }
  report.synced('roles and permissions', `${Object.keys(ROLE_DEFINITIONS).length} roles from packages/shared`);
}
