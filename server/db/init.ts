import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool, isDatabaseConfigured } from './pool.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function initDatabase(): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    console.warn('[DB Init] DATABASE_URL not set; skipping PostgreSQL schema initialization.');
    return false;
  }

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query(schemaSql);
    await client.query(
      `ALTER TABLE phone_accounts ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE`
    );
    await client.query(`INSERT INTO payment_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    console.info('[DB Init] PostgreSQL schema verified and ready.');
    return true;
  } finally {
    client.release();
  }
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  initDatabase()
    .then(async (ran) => {
      if (!ran) {
        console.error('DATABASE_URL is required to run db:init.');
        process.exitCode = 1;
      }
      await closePool();
    })
    .catch(async (err) => {
      console.error('[DB Init] Failed:', err instanceof Error ? err.message : err);
      await closePool();
      process.exitCode = 1;
    });
}
