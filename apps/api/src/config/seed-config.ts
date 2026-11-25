import { plainToInstance } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength, validateSync } from 'class-validator';
import { ConfigValidationError } from './app-config';

// Settings read only by `pnpm --filter api seed`, never by the running API.

export const SEED_PASSWORD_MIN_LENGTH = 12;

class SeedEnvironmentVariables {
  @IsOptional() @IsString() @MinLength(SEED_PASSWORD_MIN_LENGTH)
  SEED_PRANAVAN_PASSWORD?: string;

  @IsOptional() @IsString() @MinLength(SEED_PASSWORD_MIN_LENGTH)
  SEED_RAUZAN_PASSWORD?: string;

  @IsOptional() @IsString() @MinLength(SEED_PASSWORD_MIN_LENGTH)
  SEED_NASIF_PASSWORD?: string;

  @IsOptional() @IsString() @MinLength(SEED_PASSWORD_MIN_LENGTH)
  SEED_ASK_REMEDIST_PASSWORD?: string;

  // The developer's super_admin login. The only way super_admin is ever granted.
  @IsOptional() @IsString()
  SEED_SUPER_ADMIN_NAME?: string;

  @IsOptional() @IsEmail()
  SEED_SUPER_ADMIN_EMAIL?: string;

  @IsOptional() @IsString() @MinLength(SEED_PASSWORD_MIN_LENGTH)
  SEED_SUPER_ADMIN_PASSWORD?: string;
}

export type SeedPasswordEnv =
  | 'SEED_PRANAVAN_PASSWORD'
  | 'SEED_RAUZAN_PASSWORD'
  | 'SEED_NASIF_PASSWORD'
  | 'SEED_ASK_REMEDIST_PASSWORD';

export interface SeedConfig {
  /** Initial password per clinic login, if set. A login without one isn't created. */
  passwords: Partial<Record<SeedPasswordEnv, string>>;
  /** Set only when name, email and password are all given. */
  superAdmin?: { name: string; email: string; password: string };
}

export function loadSeedConfig(env: NodeJS.ProcessEnv = process.env): SeedConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const vars = plainToInstance(SeedEnvironmentVariables, present);
  const problems = validateSync(vars, { stopAtFirstError: true }).flatMap((e) => Object.values(e.constraints ?? {}));

  const superAdminFields = [vars.SEED_SUPER_ADMIN_NAME, vars.SEED_SUPER_ADMIN_EMAIL, vars.SEED_SUPER_ADMIN_PASSWORD];
  const superAdminSet = superAdminFields.filter((v) => v !== undefined).length;
  if (superAdminSet > 0 && superAdminSet < 3) {
    problems.push('SEED_SUPER_ADMIN_NAME, SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must be set together');
  }
  if (problems.length > 0) {
    throw new ConfigValidationError(problems);
  }

  return {
    passwords: {
      SEED_PRANAVAN_PASSWORD: vars.SEED_PRANAVAN_PASSWORD,
      SEED_RAUZAN_PASSWORD: vars.SEED_RAUZAN_PASSWORD,
      SEED_NASIF_PASSWORD: vars.SEED_NASIF_PASSWORD,
      SEED_ASK_REMEDIST_PASSWORD: vars.SEED_ASK_REMEDIST_PASSWORD,
    },
    superAdmin:
      vars.SEED_SUPER_ADMIN_NAME && vars.SEED_SUPER_ADMIN_EMAIL && vars.SEED_SUPER_ADMIN_PASSWORD
        ? { name: vars.SEED_SUPER_ADMIN_NAME, email: vars.SEED_SUPER_ADMIN_EMAIL, password: vars.SEED_SUPER_ADMIN_PASSWORD }
        : undefined,
  };
}
