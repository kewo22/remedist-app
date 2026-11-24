import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseConfig, loadDatabaseConfig } from './database.config';
import {
  DIRECT_POOL_MAX_CONNECTIONS,
  POOL_CONNECTION_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  POOL_MAX_CONNECTIONS,
  STARTUP_CONNECT_ATTEMPTS,
  STARTUP_CONNECT_RETRY_DELAY_MS,
} from './database.constants';

/**
 * Anything that can run a parameterised query: the service itself or the client
 * handed to a transaction callback. Repository methods take one of these so the same
 * method works both on its own and inside a caller's transaction.
 */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface DatabasePing {
  latencyMs: number;
}

function wrapClient(client: PoolClient): Queryable {
  return {
    query: <T extends QueryResultRow = QueryResultRow>(text: string, params: readonly unknown[] = []) =>
      client.query<T>(text, [...params]),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The only way the app talks to Postgres. Repositories run SQL through `query` or
 * `transaction`; nothing else imports `pg`.
 *
 * Two pools:
 * - pooled (DATABASE_URL, through Neon's PgBouncer) for normal queries;
 * - direct (DATABASE_DIRECT_URL) for migrations and advisory locks, which need a real
 *   session that PgBouncer's transaction mode can't give.
 */
@Injectable()
export class DatabaseService implements Queryable, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly config: DatabaseConfig;
  private readonly pool: Pool;
  private readonly directPool: Pool;

  constructor() {
    this.config = loadDatabaseConfig();
    this.pool = this.createPool(this.config.url, POOL_MAX_CONNECTIONS, 'pooled');
    this.directPool = this.createPool(this.config.directUrl, DIRECT_POOL_MAX_CONNECTIONS, 'direct');
  }

  async onModuleInit(): Promise<void> {
    const host = new URL(this.config.url).hostname;

    for (let attempt = 1; attempt <= STARTUP_CONNECT_ATTEMPTS; attempt++) {
      try {
        const { latencyMs } = await this.ping();
        this.logger.log(`Connected to Postgres at ${host} (${latencyMs} ms)`);
        return;
      } catch (error) {
        const message = `Postgres connection attempt ${attempt}/${STARTUP_CONNECT_ATTEMPTS} to ${host} failed: ${describeError(error)}`;
        if (attempt === STARTUP_CONNECT_ATTEMPTS) {
          this.logger.error(message);
          throw error;
        }
        this.logger.warn(`${message}. Retrying...`);
        await sleep(STARTUP_CONNECT_RETRY_DELAY_MS);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.pool.end(), this.directPool.end()]);
    this.logger.log('Postgres pools closed');
  }

  /** Runs one parameterised statement on the pooled connection. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, [...params]);
  }

  /**
   * Runs `work` inside BEGIN/COMMIT on one pooled connection. Any error rolls back
   * and is re-thrown. Use for every multi-step write.
   */
  async transaction<R>(work: (tx: Queryable) => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      const result = await work(wrapClient(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // The connection is in an unknown state: drop it rather than return it to the pool.
        releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        this.logger.error(`ROLLBACK failed: ${describeError(rollbackError)}`);
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  /**
   * Lends one connection on the direct (non-pooled) URL for the length of `work`.
   * Only for the migration runner and session-level advisory locks.
   */
  async withDirectConnection<R>(work: (db: Queryable) => Promise<R>): Promise<R> {
    const client = await this.directPool.connect();
    try {
      return await work(wrapClient(client));
    } finally {
      client.release();
    }
  }

  /** Round-trips `SELECT 1` on the pooled connection. Used by the startup check and /health. */
  async ping(): Promise<DatabasePing> {
    const startedAt = performance.now();
    await this.pool.query('SELECT 1');
    return { latencyMs: Math.round(performance.now() - startedAt) };
  }

  private createPool(connectionString: string, max: number, label: string): Pool {
    const pool = new Pool({
      connectionString,
      max,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    });
    // An idle client can error when Neon drops the connection (for example, when a compute
    // scales to zero). Without this listener the error would crash the process.
    pool.on('error', (error) => {
      this.logger.warn(`Idle ${label} Postgres connection error: ${error.message}`);
    });
    return pool;
  }
}
