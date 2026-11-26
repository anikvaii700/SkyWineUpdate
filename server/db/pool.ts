import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { runInMemoryQuery, runInMemoryTransaction } from './inMemoryFallback.ts';

let pool: Pool | null = null;
let loggedFallback = false;

function warnInMemoryFallback() {
  if (!loggedFallback) {
    loggedFallback = true;
    console.warn('[DB Pool] DATABASE_URL not set — using in-memory fallback store (data resets on restart).');
  }
}

function shouldUseSsl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname.toLowerCase();
    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
    if (sslMode === 'disable') return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return true;
  } catch {
    return true;
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(env.databaseUrl);
}

export function getPool(): Pool {
  if (!env.databaseUrl) {
    throw new HttpError(
      503,
      'DATABASE_UNAVAILABLE',
      'Database is not configured. Set DATABASE_URL in server environment variables.'
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: shouldUseSsl(env.databaseUrl) ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });

    pool.on('error', (err) => {
      console.error('[DB Pool] Unexpected idle client error:', err.message);
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = []
): Promise<QueryResult<T>> {
  if (!isDatabaseConfigured()) {
    warnInMemoryFallback();
    return runInMemoryQuery<T>(text, params);
  }
  const activePool = getPool();
  return activePool.query<T>(text, params as unknown[]);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!isDatabaseConfigured()) {
    warnInMemoryFallback();
    return runInMemoryTransaction(callback);
  }
  const activePool = getPool();
  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[DB Transaction] Rollback failed:', (rollbackErr as Error).message);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth(): Promise<'connected' | 'unconfigured' | 'error'> {
  if (!isDatabaseConfigured()) return 'unconfigured';
  try {
    await query('SELECT 1');
    return 'connected';
  } catch {
    return 'error';
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
