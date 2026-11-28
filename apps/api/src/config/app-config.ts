import { plainToInstance } from 'class-transformer';
import type { PhoneTemplate } from '../integrations/messaging/phone-templates';
import { validateSync } from 'class-validator';
import {
  EnvironmentVariables,
  LOG_LEVELS,
  LogLevelName,
  NodeEnv,
  REQUIRED_IN_PRODUCTION,
  STORAGE_VARIABLES,
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
  abstract readonly auth: {
    /** HMAC secret for staff access tokens. */
    readonly staffJwtSecret: string;
    /** HMAC secret for client (patient portal) access tokens. Always differs from the staff one. */
    readonly clientJwtSecret: string;
  };
  abstract readonly email: {
    /** Unset means demo mode: emails are logged, not sent. */
    readonly resendApiKey?: string;
    readonly from: string;
    /** Staff addresses for security alerts. May be empty. */
    readonly adminAlertEmails: readonly string[];
  };
  abstract readonly twilio: {
    readonly accountSid?: string;
    /** Also verifies Twilio's webhook signatures. */
    readonly authToken?: string;
    readonly whatsappFrom?: string;
    /** Content SIDs of the approved WhatsApp templates; a missing one sends that message by SMS. */
    readonly contentSids: Readonly<Partial<Record<PhoneTemplate, string>>>;
  };
  /** Dialog e-SMS. Unset means demo mode: SMS are logged, not sent. */
  abstract readonly esms?: {
    readonly apiKey: string;
    readonly sourceAddress: string;
  };
  abstract readonly google: {
    /** Unset means Google sign-in only accepts `demo:` tokens, and only outside production. */
    readonly oauthClientId?: string;
  };
  /**
   * Google Calendar. `oauth` is unset in demo mode (no client secret): outside production a fake
   * calendar is connected so the flow can be tried; in production connecting is refused.
   */
  abstract readonly calendar: {
    readonly oauth?: {
      readonly clientId: string;
      readonly clientSecret: string;
      /** 32-byte AES-256-GCM key for the stored tokens. */
      readonly tokenEncryptionKey: Buffer;
    };
    readonly calendarId: string;
    readonly syncCron: string;
  };
  abstract readonly turnstile: {
    /** Unset means every challenge passes (demo mode). */
    readonly secretKey?: string;
  };
  /** Unset means demo mode: files are kept in a local folder, and refused in production. */
  abstract readonly storage?: {
    readonly bucket: string;
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  abstract readonly otp: {
    readonly dailySendCap: number;
    readonly codeTtlMinutes: number;
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

  // Separate secrets, so a client token can never pass the staff guard even if a check is missed.
  if (vars.JWT_SECRET !== undefined && vars.JWT_SECRET === vars.ADMIN_JWT_SECRET) {
    problems.push('JWT_SECRET must be different from ADMIN_JWT_SECRET');
  }

  // The bucket name alone (as in .env.example) is fine; any credential or endpoint needs the rest.
  const storageStarted = STORAGE_VARIABLES.some((key) => key !== 'STORAGE_BUCKET' && key in present);
  const storageMissing = STORAGE_VARIABLES.filter((key) => !(key in present));
  if (storageStarted && storageMissing.length > 0) {
    problems.push(`Object storage needs all of ${STORAGE_VARIABLES.join(', ')}; missing ${storageMissing.join(', ')}`);
  }

  // e-SMS needs its key and sender mask together.
  if (Boolean(vars.ESMS_API_KEY) !== Boolean(vars.ESMS_SOURCE_ADDRESS)) {
    problems.push('ESMS_API_KEY and ESMS_SOURCE_ADDRESS must be set together');
  }

  // The calendar needs the client id, its secret and the token key together.
  let tokenEncryptionKey: Buffer | undefined;
  if (vars.GOOGLE_OAUTH_CLIENT_SECRET) {
    if (!vars.GOOGLE_OAUTH_CLIENT_ID) {
      problems.push('GOOGLE_OAUTH_CLIENT_ID must be set with GOOGLE_OAUTH_CLIENT_SECRET');
    }
    tokenEncryptionKey = vars.TOKEN_ENCRYPTION_KEY ? Buffer.from(vars.TOKEN_ENCRYPTION_KEY, 'base64') : undefined;
    if (tokenEncryptionKey?.length !== 32) {
      problems.push('TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64-encoded, when GOOGLE_OAUTH_CLIENT_SECRET is set');
    }
  }

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
    auth: { staffJwtSecret: vars.ADMIN_JWT_SECRET, clientJwtSecret: vars.JWT_SECRET },
    email: {
      resendApiKey: vars.RESEND_API_KEY,
      from: vars.EMAIL_FROM,
      adminAlertEmails: (vars.ADMIN_ALERT_EMAILS ?? '')
        .split(',')
        .map((address) => address.trim())
        .filter((address) => address !== ''),
    },
    twilio: {
      accountSid: vars.TWILIO_ACCOUNT_SID,
      authToken: vars.TWILIO_AUTH_TOKEN,
      whatsappFrom: vars.TWILIO_WHATSAPP_FROM,
      contentSids: {
        verification_code: vars.TWILIO_CONTENT_SID_VERIFICATION_CODE,
        booking_confirmed: vars.TWILIO_CONTENT_SID_BOOKING_CONFIRMED,
        booking_rescheduled: vars.TWILIO_CONTENT_SID_BOOKING_RESCHEDULED,
        booking_cancelled: vars.TWILIO_CONTENT_SID_BOOKING_CANCELLED,
      },
    },
    esms:
      vars.ESMS_API_KEY && vars.ESMS_SOURCE_ADDRESS
        ? { apiKey: vars.ESMS_API_KEY, sourceAddress: vars.ESMS_SOURCE_ADDRESS }
        : undefined,
    google: { oauthClientId: vars.GOOGLE_OAUTH_CLIENT_ID },
    calendar: {
      oauth:
        vars.GOOGLE_OAUTH_CLIENT_ID && vars.GOOGLE_OAUTH_CLIENT_SECRET && tokenEncryptionKey
          ? {
              clientId: vars.GOOGLE_OAUTH_CLIENT_ID,
              clientSecret: vars.GOOGLE_OAUTH_CLIENT_SECRET,
              tokenEncryptionKey,
            }
          : undefined,
      calendarId: vars.GOOGLE_CALENDAR_ID,
      syncCron: vars.AVAILABILITY_SYNC_CRON,
    },
    turnstile: { secretKey: vars.TURNSTILE_SECRET_KEY },
    storage:
      vars.STORAGE_BUCKET && vars.AWS_ENDPOINT_URL_S3 && vars.AWS_REGION && vars.AWS_ACCESS_KEY_ID && vars.AWS_SECRET_ACCESS_KEY
        ? {
            bucket: vars.STORAGE_BUCKET,
            endpoint: vars.AWS_ENDPOINT_URL_S3,
            region: vars.AWS_REGION,
            accessKeyId: vars.AWS_ACCESS_KEY_ID,
            secretAccessKey: vars.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
    otp: { dailySendCap: vars.DAILY_OTP_SEND_CAP, codeTtlMinutes: vars.OTP_CODE_TTL_MINUTES },
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
