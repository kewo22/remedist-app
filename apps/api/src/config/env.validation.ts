import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateBy,
  ValidationOptions,
  buildMessage,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

// Most to least severe. LOG_LEVEL turns on that level and everything above it.
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/** Settings that have no safe default in production: a missing one stops the boot there. */
export const REQUIRED_IN_PRODUCTION = ['WEB_URL', 'APP_URL'] as const;

/** A URL that `new URL()` accepts, using one of the given protocols (without the colon). */
function IsUrlWithProtocol(protocols: readonly string[], options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isUrlWithProtocol',
      validator: {
        validate: (value: unknown): boolean => {
          if (typeof value !== 'string') {
            return false;
          }
          try {
            return protocols.includes(new URL(value).protocol.replace(/:$/, ''));
          } catch {
            return false;
          }
        },
        // Names the variable and the expected protocols. Never echoes the value: it can hold a password.
        defaultMessage: buildMessage(
          (each) => `${each}$property must be a valid ${protocols.join(' or ')} URL`,
          options,
        ),
      },
    },
    options,
  );
}

/**
 * Every environment variable the API reads, with its rules and local defaults.
 * Add new ones here (and to .env.example) as each domain needs them.
 *
 * loadAppConfig reports only the first failing check per variable, and class-validator
 * runs decorators bottom-up: put the type/format check closest to the property.
 */
export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  @Type(() => Number)
  @Min(1)
  @Max(65535)
  @IsInt()
  PORT = 3001;

  /** The web app's origin: allowed by CORS and used for links in emails. */
  @IsUrlWithProtocol(['http', 'https'])
  WEB_URL = 'http://localhost:3000';

  /** This API's own public URL (webhooks, OAuth callbacks). */
  @IsUrlWithProtocol(['http', 'https'])
  APP_URL = 'http://localhost:3001';

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevelName = 'log';

  /** Neon pooled URL (host contains "-pooler"). Required: no default. */
  @IsUrlWithProtocol(['postgres', 'postgresql'])
  DATABASE_URL!: string;

  /** Neon direct URL, the name `neon env pull` writes. Migrations and job locks. Required: no default. */
  @IsUrlWithProtocol(['postgres', 'postgresql'])
  DATABASE_URL_UNPOOLED!: string;

  /** Signs staff access tokens. Required: a long random string, e.g. `openssl rand -base64 48`. */
  @MinLength(32, { message: 'ADMIN_JWT_SECRET must be at least 32 characters (use a random value)' })
  @IsString()
  ADMIN_JWT_SECRET!: string;

  /** Signs client (patient portal) access tokens. Required, and must differ from ADMIN_JWT_SECRET. */
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters (use a random value)' })
  @IsString()
  JWT_SECRET!: string;

  // ── Email (Resend). Without a key, emails are logged instead of sent (demo mode). ──

  @IsOptional()
  @IsString()
  RESEND_API_KEY?: string;

  /** The From header, e.g. `The Remedist <hello@theremedist.com>`. Must be a domain verified in Resend. */
  @IsString()
  EMAIL_FROM = 'The Remedist <hello@theremedist.com>';

  /** Comma-separated staff emails for security alerts (the daily OTP cap). */
  @IsOptional()
  @IsString()
  ADMIN_ALERT_EMAILS?: string;

  // ── Google sign-in. Without it, only `demo:` test tokens work, and only outside production. ──

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  // ── Cloudflare Turnstile. Without it, every challenge passes (demo mode). ──

  @IsOptional()
  @IsString()
  TURNSTILE_SECRET_KEY?: string;

  // ── One-time codes ──

  /** Clinic-wide cap on codes sent per UTC day (a circuit breaker against SMS/email bombing). */
  @Type(() => Number)
  @Min(1)
  @IsInt()
  DAILY_OTP_SEND_CAP = 300;

  /** How long phone and password-reset codes stay valid. */
  @Type(() => Number)
  @Max(60)
  @Min(1)
  @IsInt()
  OTP_CODE_TTL_MINUTES = 10;
}
