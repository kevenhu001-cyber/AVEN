import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);

function retentionDays(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

async function main(): Promise<void> {
  const deletionDays = retentionDays('MEMORY_DELETION_RETENTION_DAYS', 30);
  const eventDays = retentionDays('MEMORY_EVENT_RETENTION_DAYS', 365);
  const pool = createPool('aven_worker', { max: 1 });
  try {
    const expired = await pool.query<{ count: number }>(
      'SELECT app.expire_due_memories(100) AS count',
    );
    const purged = await pool.query<{ count: number }>(
      'SELECT app.purge_deleted_memories($1) AS count',
      [deletionDays],
    );
    const purgedEvents = await pool.query<{ count: number }>(
      'SELECT app.purge_memory_events($1) AS count',
      [eventDays],
    );
    console.log(
      JSON.stringify({
        expired: expired.rows[0]?.count ?? 0,
        purged: purged.rows[0]?.count ?? 0,
        purgedEvents: purgedEvents.rows[0]?.count ?? 0,
        deletionRetentionDays: deletionDays,
        eventRetentionDays: eventDays,
      }),
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Memory maintenance failed.');
  process.exitCode = 1;
});
