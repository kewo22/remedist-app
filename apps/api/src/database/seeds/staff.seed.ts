import { Role } from '@remedist/shared';
import { hash } from 'bcryptjs';
import type { SeedConfig, SeedPasswordEnv } from '../../config/seed-config';
import type { Queryable } from '../database.service';
import type { SeedReport } from './seed-report';

/** Same cost as the old app, so its existing hashes and new ones verify the same way. */
export const BCRYPT_COST = 10;

interface StaffLoginSeed {
  name: string;
  email: string;
  roles: readonly Role[];
  passwordEnv: SeedPasswordEnv;
  /** Gives the login a practitioner profile, so patients can book with them. */
  practitioner?: { displayName: string; title?: string };
}

// The clinic's CRM logins. Passwords are never in code: each comes from its environment
// variable, and a login is created only when that variable is set.
const CLINIC_LOGINS: readonly StaffLoginSeed[] = [
  {
    name: 'Rauzan',
    email: 'rauzan@theremedist.com',
    roles: [Role.OWNER, Role.DOCTOR],
    passwordEnv: 'SEED_RAUZAN_PASSWORD',
    practitioner: { displayName: 'Rauzan Aly' },
  },
  { name: 'Pranavan', email: 'admin@theremedist.com', roles: [Role.OWNER], passwordEnv: 'SEED_PRANAVAN_PASSWORD' },
  { name: 'Nasif', email: 'nasif@theremedist.com', roles: [Role.OWNER], passwordEnv: 'SEED_NASIF_PASSWORD' },
  // Scoped login: the Ask Remedist panel only.
  {
    name: 'Pranavan',
    email: 'pranavan.ask@theremedist.com',
    roles: [Role.ASK_REMEDIST],
    passwordEnv: 'SEED_ASK_REMEDIST_PASSWORD',
  },
];

async function findStaffId(db: Queryable, email: string): Promise<string | undefined> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM auth.staff_users WHERE lower(email) = lower($1)', [
    email,
  ]);
  return rows[0]?.id;
}

async function createLogin(
  db: Queryable,
  login: { name: string; email: string; roles: readonly Role[] },
  password: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO auth.staff_users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [login.name, login.email, await hash(password, BCRYPT_COST)],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`Could not create staff login ${login.email}`);
  }
  await db.query(
    `INSERT INTO auth.staff_user_roles (staff_user_id, role_code)
     SELECT $1, unnest($2::text[])`,
    [id, login.roles],
  );
  return id;
}

/**
 * Creates missing staff logins with their roles and practitioner profiles. Never changes an
 * existing login, its password or its roles. Needs syncRolesAndPermissions to have run first.
 */
export async function seedStaffLogins(db: Queryable, config: SeedConfig, report: SeedReport): Promise<void> {
  for (const login of CLINIC_LOGINS) {
    const label = `staff login ${login.email} (${login.roles.join(' + ')})`;
    let id = await findStaffId(db, login.email);

    if (id) {
      report.skipped(label, 'already exists');
    } else {
      const password = config.passwords[login.passwordEnv];
      if (!password) {
        report.warn(label, `not created: set ${login.passwordEnv}`);
        continue;
      }
      id = await createLogin(db, login, password);
      report.created(label);
    }

    if (login.practitioner) {
      const { rowCount } = await db.query(
        `INSERT INTO practitioners (staff_user_id, display_name, title) VALUES ($1, $2, $3)
         ON CONFLICT (staff_user_id) DO NOTHING`,
        [id, login.practitioner.displayName, login.practitioner.title ?? null],
      );
      if (rowCount) {
        report.created(`practitioner ${login.practitioner.displayName}`);
      }
    }
  }

  // super_admin is only ever granted here, from env, never from the CRM.
  if (config.superAdmin) {
    const sa = config.superAdmin;
    const label = `staff login ${sa.email} (super_admin)`;
    if (await findStaffId(db, sa.email)) {
      report.skipped(label, 'already exists');
    } else {
      await createLogin(db, { name: sa.name, email: sa.email, roles: [Role.SUPER_ADMIN] }, sa.password);
      report.created(label, "can't sign in until MFA is built");
    }
  }
}
