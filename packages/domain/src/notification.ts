import { z } from 'zod';
import type { DatabasePool } from '@aven/database';

export const NotificationJobSchema = z
  .object({ eventId: z.uuid(), generation: z.number().int().nonnegative() })
  .strict();
export type NotificationJob = z.infer<typeof NotificationJobSchema>;
const DeliveryResultSchema = z.enum(['delivered', 'suppressed', 'dead', 'ignored']);
export async function deliverNotification(pool: DatabasePool, input: unknown, attempt: number) {
  const job = NotificationJobSchema.safeParse(input);
  if (!job.success || !Number.isInteger(attempt) || attempt < 1 || attempt > 5)
    throw new Error('INVALID_NOTIFICATION_JOB');
  const result = await pool.query<{ result: unknown }>(
    'SELECT app.deliver_notification($1,$2,$3) AS result',
    [job.data.eventId, job.data.generation, attempt],
  );
  const parsed = DeliveryResultSchema.safeParse(result.rows[0]?.result);
  if (!parsed.success) throw new Error('INVALID_DELIVERY_RESULT');
  return parsed.data;
}
export async function failNotification(pool: DatabasePool, input: unknown, attempt: number) {
  const job = NotificationJobSchema.safeParse(input);
  if (!job.success || !Number.isInteger(attempt) || attempt < 1 || attempt > 5)
    throw new Error('INVALID_NOTIFICATION_JOB');
  await pool.query('SELECT app.fail_notification_delivery($1,$2,$3)', [
    job.data.eventId,
    job.data.generation,
    attempt,
  ]);
}
