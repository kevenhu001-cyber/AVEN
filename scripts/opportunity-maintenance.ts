import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';

const root = process.cwd();
const envFile = resolve(root, '.env');
if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);

async function main(): Promise<void> {
  const pool = createPool('aven_worker', { max: 1 });
  try {
    const expired = await pool.query<{ count: number }>(
      'SELECT app.expire_due_opportunities() AS count',
    );
    console.log(
      JSON.stringify({
        expiredOpportunities: expired.rows[0]?.count ?? 0,
      }),
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Opportunity maintenance failed.');
  process.exitCode = 1;
});
