import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client, DatabaseError } from 'pg';

/** Copied next to the compiled runner by nest-cli's `assets` setting. */
export const MIGRATIONS_DIR = join(__dirname, 'migrations');

// 0001_some_name.sql: a 4-digit version, then a lowercase name.
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

// Arbitrary constant: every runner instance takes the same lock, so only one migrates at a time.
const MIGRATION_LOCK_ID = 727_274_001;

export interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
}

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: Date;
}

export type MigrationState = 'applied' | 'pending' | 'changed' | 'missing';

export interface MigrationStatus {
  version: number;
  name: string;
  state: MigrationState;
  appliedAt?: Date;
}

export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

/** "0007_content_and_ai", as the file is named. */
function label(s: { version: number; name: string }): string {
  return `${String(s.version).padStart(4, '0')}_${s.name}`;
}

/** sha256 of the file with line endings normalised, so a Windows checkout (CRLF) matches Linux (LF). */
function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export async function readMigrationFiles(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  const seen = new Map<number, string>();

  for (const fileName of entries) {
    const match = MIGRATION_FILE.exec(fileName);
    if (!match) {
      throw new MigrationError(`${fileName} doesn't match NNNN_lowercase_name.sql`);
    }
    const version = Number(match[1]);
    const clash = seen.get(version);
    if (clash) {
      throw new MigrationError(`${fileName} and ${clash} share version ${version}`);
    }
    seen.set(version, fileName);
    const sql = await readFile(join(dir, fileName), 'utf8');
    files.push({ version, name: match[2] ?? fileName, fileName, sql, checksum: checksumOf(sql) });
  }
  return files;
}

/** Turns a Postgres error into "line N: message (detail)" relative to the migration file. */
function describeSqlError(error: unknown, sql: string): string {
  const pgError = error as Partial<DatabaseError>;
  const message = error instanceof Error ? error.message : String(error);
  const position = Number(pgError.position);
  const line = Number.isFinite(position) && position > 0 ? sql.slice(0, position).split('\n').length : undefined;
  const detail = pgError.detail ? ` (${pgError.detail})` : '';
  return `${line ? `line ${line}: ` : ''}${message}${detail}`;
}

/**
 * Applies numbered .sql files in order, each in its own transaction, and records them in
 * schema_migrations. Needs a session on the direct (non-pooled) URL: it holds an advisory lock
 * for the whole run, which PgBouncer's transaction mode can't keep.
 */
export class Migrator {
  private readonly logger = new Logger('Migrator');

  constructor(
    private readonly client: Client,
    private readonly dir = MIGRATIONS_DIR,
  ) {}

  /** Applies every pending migration. Returns the versions applied. */
  async migrate(): Promise<number[]> {
    return this.withLock(async () => {
      await this.ensureLedger();
      const plan = await this.plan();
      const pending = plan.filter((p) => p.state === 'pending');
      if (pending.length === 0) {
        this.logger.log('Database is up to date.');
        return [];
      }

      const files = new Map((await readMigrationFiles(this.dir)).map((f) => [f.version, f]));
      const applied: number[] = [];
      for (const { version } of pending) {
        const file = files.get(version);
        if (!file) {
          continue;
        }
        await this.apply(file);
        applied.push(version);
      }
      this.logger.log(`Applied ${applied.length} migration(s).`);
      return applied;
    });
  }

  /** Every known migration and whether it's applied, pending, changed since it ran, or missing on disk. */
  async status(): Promise<MigrationStatus[]> {
    await this.ensureLedger();
    return this.plan({ allowProblems: true });
  }

  private async plan({ allowProblems = false } = {}): Promise<MigrationStatus[]> {
    const files = await readMigrationFiles(this.dir);
    const { rows } = await this.client.query<AppliedRow>(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(rows.map((r) => [r.version, r]));

    const statuses: MigrationStatus[] = files.map((file) => {
      const row = applied.get(file.version);
      if (!row) {
        return { version: file.version, name: file.name, state: 'pending' };
      }
      const state = row.checksum === file.checksum ? 'applied' : 'changed';
      return { version: file.version, name: file.name, state, appliedAt: row.applied_at };
    });
    for (const row of rows) {
      if (!files.some((f) => f.version === row.version)) {
        statuses.push({ version: row.version, name: row.name, state: 'missing', appliedAt: row.applied_at });
      }
    }
    statuses.sort((a, b) => a.version - b.version);

    if (!allowProblems) {
      const changed = statuses.filter((s) => s.state === 'changed');
      if (changed.length > 0) {
        throw new MigrationError(
          `Already-applied migration(s) were edited: ${changed.map(label).join(', ')}. ` +
            'Never edit a migration that has run; add a new one instead.',
        );
      }
      const firstPending = statuses.find((s) => s.state === 'pending');
      const lastApplied = statuses.filter((s) => s.state === 'applied').at(-1);
      if (firstPending && lastApplied && firstPending.version < lastApplied.version) {
        throw new MigrationError(
          `Migration ${label(firstPending)} is older than the latest applied one ` +
            `(${label(lastApplied)}). Renumber it after ${label(lastApplied)}.`,
        );
      }
    }
    return statuses;
  }

  private async apply(file: MigrationFile): Promise<void> {
    const startedAt = performance.now();
    await this.client.query('BEGIN');
    try {
      await this.client.query(file.sql);
      await this.client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
        file.version,
        file.name,
        file.checksum,
      ]);
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK').catch(() => undefined);
      throw new MigrationError(`${file.fileName} failed and was rolled back. ${describeSqlError(error, file.sql)}`, {
        cause: error,
      });
    }
    this.logger.log(`Applied ${file.fileName} (${Math.round(performance.now() - startedAt)} ms)`);
  }

  private async ensureLedger(): Promise<void> {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const { rows } = await this.client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      MIGRATION_LOCK_ID,
    ]);
    if (!rows[0]?.locked) {
      throw new MigrationError('Another migration run holds the lock. Wait for it to finish, then try again.');
    }
    try {
      return await work();
    } finally {
      await this.client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  }
}
