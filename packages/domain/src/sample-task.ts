import { z } from 'zod';
import type { DatabasePool } from '@aven/database';

export const sampleTaskConsumer = 'sample-task-v1';

export const SampleTaskPayloadSchema = z
  .object({
    taskId: z.uuid(),
    title: z.string().min(1).max(200),
    simulate: z.enum(['unknown', 'fail']).optional(),
  })
  .strict();

export const SampleTaskEventSchema = z
  .object({
    id: z.uuid(),
    eventType: z.literal('sample_task.created'),
    payload: SampleTaskPayloadSchema,
  })
  .strict();

export type SampleTaskPayload = z.infer<typeof SampleTaskPayloadSchema>;
export type SampleTaskEvent = z.infer<typeof SampleTaskEventSchema>;

export type SampleTaskResult = {
  taskId: string;
  replayed: boolean;
};

export class RetryableSampleTaskError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'RetryableSampleTaskError';
  }
}

export class UnknownExternalResultError extends RetryableSampleTaskError {
  constructor() {
    super('UNKNOWN_EXTERNAL_RESULT');
    this.name = 'UnknownExternalResultError';
  }
}

export async function createSampleTask(
  pool: DatabasePool,
  input: { title: string; simulate?: 'unknown' | 'fail' },
): Promise<{ taskId: string; eventId: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query<{ id: string }>(
      'INSERT INTO app.sample_tasks (title) VALUES ($1) RETURNING id',
      [input.title],
    );
    const taskId = task.rows[0]?.id;
    if (!taskId) throw new Error('Sample task insert returned no id.');
    const payload: SampleTaskPayload = {
      taskId,
      title: input.title,
      ...(input.simulate ? { simulate: input.simulate } : {}),
    };
    const event = await client.query<{ id: string }>(
      `INSERT INTO public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('sample_task', $1, 'sample_task.created', $2)
       RETURNING id`,
      [taskId, payload],
    );
    const eventId = event.rows[0]?.id;
    if (!eventId) throw new Error('Outbox insert returned no id.');
    await client.query('COMMIT');
    return { taskId, eventId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markReceipt(
  pool: DatabasePool,
  eventId: string,
  status: 'failed' | 'unknown' | 'dead',
  attempt: number,
  errorCode: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.job_receipts
       (event_id, consumer, status, attempts, last_error_code, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (event_id, consumer) DO UPDATE
     SET status = EXCLUDED.status,
         attempts = EXCLUDED.attempts,
         last_error_code = EXCLUDED.last_error_code,
         lease_token = null,
         lease_expires_at = null,
         updated_at = now()`,
    [eventId, sampleTaskConsumer, status, attempt, errorCode],
  );
}

export async function markReceiptDead(
  pool: DatabasePool,
  eventId: string,
  attempt: number,
  errorCode: string,
): Promise<void> {
  await markReceipt(pool, eventId, 'dead', attempt, errorCode);
}

export async function processSampleTask(
  pool: DatabasePool,
  event: SampleTaskEvent,
  options: { attempt: number; leaseToken: string },
): Promise<SampleTaskResult> {
  const parsed = SampleTaskEventSchema.parse(event);
  const { id: eventId, payload } = parsed;

  const existing = await pool.query<{ status: string; result_resource_id: string | null }>(
    'SELECT status, result_resource_id FROM public.job_receipts WHERE event_id = $1 AND consumer = $2',
    [eventId, sampleTaskConsumer],
  );
  if (existing.rows[0]?.status === 'succeeded') {
    return { taskId: payload.taskId, replayed: true };
  }

  await pool.query(
    `INSERT INTO public.job_receipts
       (event_id, consumer, status, lease_token, lease_expires_at, attempts, updated_at)
     VALUES ($1, $2, 'running', $3, now() + interval '30 seconds', $4, now())
     ON CONFLICT (event_id, consumer) DO UPDATE
     SET status = 'running',
         lease_token = EXCLUDED.lease_token,
         lease_expires_at = EXCLUDED.lease_expires_at,
         attempts = EXCLUDED.attempts,
         updated_at = now()
     WHERE public.job_receipts.status <> 'succeeded'`,
    [eventId, sampleTaskConsumer, options.leaseToken, options.attempt],
  );

  if (payload.simulate === 'fail') {
    await markReceipt(pool, eventId, 'failed', options.attempt, 'SAMPLE_FAILURE');
    throw new RetryableSampleTaskError('SAMPLE_FAILURE');
  }

  const effectKey = `${eventId}:${sampleTaskConsumer}`;
  let effect = await pool.query<{ result: unknown }>(
    'SELECT result FROM app.sample_external_effects WHERE idempotency_key = $1',
    [effectKey],
  );
  if (!effect.rows[0]) {
    const result = { taskId: payload.taskId, processedAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO app.sample_external_effects (idempotency_key, result)
       VALUES ($1, $2)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [effectKey, result],
    );
    effect = await pool.query<{ result: unknown }>(
      'SELECT result FROM app.sample_external_effects WHERE idempotency_key = $1',
      [effectKey],
    );
    if (payload.simulate === 'unknown') {
      await markReceipt(pool, eventId, 'unknown', options.attempt, 'UNKNOWN_EXTERNAL_RESULT');
      throw new UnknownExternalResultError();
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app.sample_task_results (event_id, consumer, result)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, consumer) DO NOTHING`,
      [eventId, sampleTaskConsumer, effect.rows[0]?.result ?? {}],
    );
    await client.query(
      `INSERT INTO public.job_receipts
         (event_id, consumer, status, attempts, result_resource_id, completed_at, updated_at)
       VALUES ($1, $2, 'succeeded', $3, $4, now(), now())
       ON CONFLICT (event_id, consumer) DO UPDATE
       SET status = 'succeeded',
           attempts = EXCLUDED.attempts,
           result_resource_id = EXCLUDED.result_resource_id,
           completed_at = now(),
           last_error_code = null,
           lease_token = null,
           lease_expires_at = null,
           updated_at = now()`,
      [eventId, sampleTaskConsumer, options.attempt, payload.taskId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return { taskId: payload.taskId, replayed: false };
}
