import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
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

/**
 * Object storage settings. With no endpoint or credentials, files go to the local demo store; once
 * any of those is set, all of these are required.
 */
export const STORAGE_VARIABLES = [
  'STORAGE_BUCKET',
  'AWS_ENDPOINT_URL_S3',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

/** A Twilio Content SID (an approved WhatsApp template). */
const CONTENT_SID = /^HX[0-9a-fA-F]{32}$/;

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

  // ── Twilio WhatsApp. Without the SID, token and sender, WhatsApp is logged, not sent (demo mode). ──

  @IsOptional()
  @IsString()
  TWILIO_ACCOUNT_SID?: string;

  /** Also verifies the X-Twilio-Signature on Twilio's webhooks. */
  @IsOptional()
  @IsString()
  TWILIO_AUTH_TOKEN?: string;

  /** The WhatsApp sender, e.g. `whatsapp:+14155238886`. */
  @IsOptional()
  @Matches(/^whatsapp:\+[1-9]\d{6,14}$/, { message: 'TWILIO_WHATSAPP_FROM must look like whatsapp:+14155238886' })
  TWILIO_WHATSAPP_FROM?: string;

  // Meta-approved WhatsApp templates (Twilio Content SIDs, HX...). A message type without one skips
  // WhatsApp and goes by SMS. See integrations/messaging/phone-templates.ts for each one's variables.

  @IsOptional()
  @Matches(CONTENT_SID, { message: 'TWILIO_CONTENT_SID_VERIFICATION_CODE must be a Twilio Content SID (HX + 32 hex)' })
  TWILIO_CONTENT_SID_VERIFICATION_CODE?: string;

  @IsOptional()
  @Matches(CONTENT_SID, { message: 'TWILIO_CONTENT_SID_BOOKING_CONFIRMED must be a Twilio Content SID (HX + 32 hex)' })
  TWILIO_CONTENT_SID_BOOKING_CONFIRMED?: string;

  @IsOptional()
  @Matches(CONTENT_SID, { message: 'TWILIO_CONTENT_SID_BOOKING_RESCHEDULED must be a Twilio Content SID (HX + 32 hex)' })
  TWILIO_CONTENT_SID_BOOKING_RESCHEDULED?: string;

  @IsOptional()
  @Matches(CONTENT_SID, { message: 'TWILIO_CONTENT_SID_BOOKING_CANCELLED must be a Twilio Content SID (HX + 32 hex)' })
  TWILIO_CONTENT_SID_BOOKING_CANCELLED?: string;

  // ── SMS by Dialog e-SMS (Sri Lankan mobiles only). Without both, SMS is logged, not sent (demo mode). ──

  /** The e-SMS API key (`esmsqk`). */
  @IsOptional()
  @IsString()
  ESMS_API_KEY?: string;

  /** The approved sender mask shown to the recipient, e.g. `Remedist` (up to 11 characters). */
  @IsOptional()
  @Matches(/^[A-Za-z0-9 ]{1,11}$/, { message: 'ESMS_SOURCE_ADDRESS must be the approved sender mask (1-11 letters or digits)' })
  ESMS_SOURCE_ADDRESS?: string;

  // ── Google sign-in. Without it, only `demo:` test tokens work, and only outside production. ──

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  // ── Google Calendar (same OAuth client). Without the secret, the calendar runs in demo mode. ──

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  /** The connected account's calendar to use; 'primary' is its main calendar. */
  @IsString()
  GOOGLE_CALENDAR_ID = 'primary';

  /** Encrypts stored OAuth tokens (AES-256-GCM): 32 random bytes, base64. Required with the secret. */
  @IsOptional()
  @IsString()
  TOKEN_ENCRYPTION_KEY?: string;

  /** When the calendar job runs (cron, 5 or 6 fields). */
  @Matches(/^\S+( \S+){4,5}$/, { message: 'AVAILABILITY_SYNC_CRON must be a cron expression with 5 or 6 fields' })
  AVAILABILITY_SYNC_CRON = '*/5 * * * *';

  // ── Cloudflare Turnstile. Without it, every challenge passes (demo mode). ──

  @IsOptional()
  @IsString()
  TURNSTILE_SECRET_KEY?: string;

  // ── Object storage (Neon, S3-compatible). Without it, files go to a local folder (demo mode). ──
  // The four AWS_* names are Neon's: `neon env pull` fills them for the checked-out branch.

  @IsOptional()
  @IsString()
  STORAGE_BUCKET?: string;

  @IsOptional()
  @IsUrlWithProtocol(['https', 'http'])
  AWS_ENDPOINT_URL_S3?: string;

  @IsOptional()
  @IsString()
  AWS_REGION?: string;

  @IsOptional()
  @IsString()
  AWS_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  AWS_SECRET_ACCESS_KEY?: string;

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
