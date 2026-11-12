import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';
import { NotificationMaintenanceBatchSchema } from '../packages/contracts/dist/index.js';
const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) loadEnvFile(envFile);
async function main() {
  const parsed = NotificationMaintenanceBatchSchema.safeParse(
    process.env.NOTIFICATION_MAINTENANCE_BATCH_SIZE,
  );
  if (!parsed.success) throw new Error('INVALID_BATCH_SIZE');
  const pool = createPool('aven_worker', { max: 1 });
  try {
    const result = await pool.query<{ count: number }>(
      'SELECT app.purge_old_notifications($1) AS count',
      [parsed.data],
    );
    const count = result.rows[0]?.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > parsed.data)
      throw new Error('INVALID_MAINTENANCE_RESULT');
    console.log(
      JSON.stringify({
        event: 'notifications.maintenance_completed',
        purgedNotifications: count,
        batchSize: parsed.data,
        retentionDays: 90,
      }),
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Notification maintenance failed; check configuration and database readiness.');
  process.exitCode = 1;
});
