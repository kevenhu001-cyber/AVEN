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

function retentionHours(): number {
  const value = Number(process.env.AGENT_EVENT_RETENTION_HOURS ?? 24);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('AGENT_EVENT_RETENTION_HOURS must be a positive integer.');
  }
  return value;
}

async function main(): Promise<void> {
  const hours = retentionHours();
  const pool = createPool('aven_worker', { max: 1 });
  try {
    const result = await pool.query<{ count: number }>(
      'SELECT app.purge_agent_run_events($1) AS count',
      [hours],
    );
    console.log(
      JSON.stringify({
        purgedEvents: result.rows[0]?.count ?? 0,
        retentionHours: hours,
      }),
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Agent maintenance failed.');
  process.exitCode = 1;
});
