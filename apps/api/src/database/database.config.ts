// Reads and checks the database settings once, at startup.
// Folds into the app-wide typed config when "Add input validation, settings loading and logging" lands.

export interface DatabaseConfig {
  /** Neon pooled URL (host contains "-pooler"). Used for every normal query. */
  url: string;
  /** Neon direct URL (DATABASE_URL_UNPOOLED, the name `neon env pull` writes). Used for migrations and job advisory locks. */
  directUrl: string;
}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

// pg 8 treats these as verify-full (and warns); pg 9 will downgrade them to libpq's weaker
// meaning. `neon env pull` writes sslmode=require, so pin verify-full here: Neon serves
// publicly trusted certificates, so the full check always passes.
const SSL_MODES_TO_PIN = new Set(['prefer', 'require', 'verify-ca']);

function pinFullTlsVerification(url: URL): string {
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && SSL_MODES_TO_PIN.has(sslmode)) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}

function readPostgresUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. Copy apps/api/.env.example to apps/api/.env and fill it in.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Never echo the value: it contains the database password.
    throw new Error(`${name} is not a valid URL.`);
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${name} must start with postgres:// or postgresql://.`);
  }
  return pinFullTlsVerification(parsed);
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    url: readPostgresUrl(env, 'DATABASE_URL'),
    directUrl: readPostgresUrl(env, 'DATABASE_URL_UNPOOLED'),
  };
}
