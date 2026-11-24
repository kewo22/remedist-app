// Reads and checks the database settings once, at startup.
// Folds into the app-wide typed config when "Add input validation, settings loading and logging" lands.

export interface DatabaseConfig {
  /** Neon pooled URL (host contains "-pooler"). Used for every normal query. */
  url: string;
  /** Neon direct URL. Used for migrations and job advisory locks. */
  directUrl: string;
}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

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
  return value;
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    url: readPostgresUrl(env, 'DATABASE_URL'),
    directUrl: readPostgresUrl(env, 'DATABASE_DIRECT_URL'),
  };
}
