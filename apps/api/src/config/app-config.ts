import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  EnvironmentVariables,
  LOG_LEVELS,
  LogLevelName,
  NodeEnv,
  REQUIRED_IN_PRODUCTION,
} from './env.validation';

/**
 * The API's typed settings. Inject it anywhere (`constructor(private readonly config: AppConfig)`);
 * never read `process.env` outside this folder.
 *
 * An abstract class rather than an interface so it can be the injection token.
 */
export abstract class AppConfig {
  abstract readonly nodeEnv: NodeEnv;
  abstract readonly isProduction: boolean;
  abstract readonly port: number;
  abstract readonly webUrl: string;
  abstract readonly appUrl: string;
  abstract readonly logLevel: LogLevelName;
  abstract readonly database: {
    /** Pooled (PgBouncer) URL for normal queries. */
    readonly url: string;
    /** Direct URL for migrations and session-level advisory locks. */
    readonly directUrl: string;
  };
}

export class ConfigValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/** Origins are compared exactly by CORS, so keep only scheme://host[:port]. */
function toOrigin(url: string): string {
  return new URL(url).origin;
}

/** Validates the environment and builds the typed config. Throws ConfigValidationError listing every problem. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Blank values count as unset, so `FOO=` in .env falls back to the default.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''));

  const vars = plainToInstance(EnvironmentVariables, present, { exposeDefaultValues: true });
  // One problem per variable is enough to fix it; the rest are usually knock-on effects.
  const problems = validateSync(vars, { stopAtFirstError: true }).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

  if (vars.NODE_ENV === 'production') {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!(key in present)) {
        problems.push(`${key} must be set in production`);
      }
    }
  }

  if (problems.length > 0) {
    throw new ConfigValidationError(problems);
  }

  return {
    nodeEnv: vars.NODE_ENV,
    isProduction: vars.NODE_ENV === 'production',
    port: vars.PORT,
    webUrl: toOrigin(vars.WEB_URL),
    appUrl: vars.APP_URL.replace(/\/+$/, ''),
    logLevel: vars.LOG_LEVEL,
    database: { url: vars.DATABASE_URL, directUrl: vars.DATABASE_URL_UNPOOLED },
  };
}

/** The levels Nest's logger should print for a given LOG_LEVEL. */
export function enabledLogLevels(level: LogLevelName): LogLevelName[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
}

let cached: AppConfig | undefined;

/** Loads the config once per process; main.ts and the ConfigModule share the same instance. */
export function getAppConfig(): AppConfig {
  cached ??= loadAppConfig();
  return cached;
}
