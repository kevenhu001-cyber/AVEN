import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';
import {
  ConnectionMaintenanceBatchSchema,
  ConnectionMaintenanceResultSchema,
} from '../packages/contracts/dist/index.js';

const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) loadEnvFile(envFile);

async function main(): Promise<void> {
  const batch = ConnectionMaintenanceBatchSchema.safeParse(
    process.env.CONNECTION_MAINTENANCE_BATCH_SIZE,
  );
  if (!batch.success) throw new Error('INVALID_BATCH_SIZE');
  const pool = createPool('aven_worker', { max: 1 });
  try {
    const response = await pool.query<{ result: unknown }>(
      'SELECT app.maintain_personal_connections($1) AS result',
      [batch.data],
    );
    const result = ConnectionMaintenanceResultSchema.safeParse(response.rows[0]?.result);
    if (!result.success) throw new Error('INVALID_MAINTENANCE_RESPONSE');
    console.log(
      JSON.stringify({
        event: 'connections.maintenance_completed',
        batchSize: batch.data,
        ...result.data,
      }),
    );
  } finally {
    await pool.end();
  }
}
void main().catch(() => {
  console.error('Connection maintenance failed; check configuration and database readiness.');
  process.exitCode = 1;
});
