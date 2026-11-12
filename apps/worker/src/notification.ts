import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { redisUrl } from '@aven/config/env';
import type { LogWriter } from '@aven/config/logger';
import type { DatabasePool } from '@aven/database';
import { deliverNotification, failNotification, type NotificationJob } from '@aven/domain';
import { OutboxDispatcher } from './outbox.js';

export function createNotificationRuntime(pool: DatabasePool, log: LogWriter) {
  const queueConnection = new Redis(redisUrl(), { maxRetriesPerRequest: 1 });
  const workerConnection = new Redis(redisUrl(), { maxRetriesPerRequest: null });
  for (const connection of [queueConnection, workerConnection])
    connection.on('error', () => log({ level: 'error', event: 'notification.redis_error' }));
  const failures = new Set<Promise<unknown>>();
  const queue = new Queue<NotificationJob, string>('aven-notification', {
    connection: queueConnection,
  });
  const worker = new Worker<NotificationJob, string>(
    'aven-notification',
    (job) => deliverNotification(pool, job.data, job.attemptsMade + 1),
    { connection: workerConnection, concurrency: 2 },
  );
  worker.on('completed', (job) =>
    log({ level: 'info', event: 'notification.completed', ...(job.id ? { job_id: job.id } : {}) }),
  );
  worker.on('failed', (job) => {
    log({ level: 'error', event: 'notification.failed', ...(job?.id ? { job_id: job.id } : {}) });
    if (!job) return;
    const failure = failNotification(pool, job.data, job.attemptsMade).catch(() =>
      log({ level: 'error', event: 'notification.failure_record_failed' }),
    );
    failures.add(failure);
    void failure.finally(() => failures.delete(failure));
  });
  worker.on('error', () => log({ level: 'error', event: 'notification.queue_error' }));
  async function enqueue(eventId: string, recovery = false) {
    const result = await pool.query<{ generation: number }>(
      "SELECT generation FROM public.notification_deliveries WHERE event_id=$1 AND status='pending'",
      [eventId],
    );
    const generation = result.rows[0]?.generation;
    if (generation === undefined) return;
    await queue.add(
      'in-app',
      { eventId, generation },
      {
        jobId: `${eventId}-g${generation}${recovery ? `-recover-${randomUUID()}` : ''}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: false,
      },
    );
    await pool.query('SELECT app.mark_notification_enqueued($1,$2)', [eventId, generation]);
  }
  const dispatcher = new OutboxDispatcher(pool, undefined, log, {
    eventType: 'notification.requested',
    enqueue: (row) => enqueue(row.id),
    reconcile: async () => {
      const pending = await pool.query<{
        event_id: string;
      }>(`SELECT d.event_id FROM public.notification_deliveries d JOIN public.outbox_events o ON o.id=d.event_id
        WHERE d.status='pending' AND o.status='processed' AND coalesce(d.last_queued_at,o.processed_at)<clock_timestamp()-interval '30 seconds'
        ORDER BY coalesce(d.last_queued_at,o.processed_at),d.event_id LIMIT 10`);
      for (const row of pending.rows) await enqueue(row.event_id, true);
      if (pending.rows.length)
        log({ level: 'warn', event: 'notification.reconciled', count: pending.rows.length });
      return pending.rows.length;
    },
  });
  return {
    queue,
    dispatcher,
    isRunning: () => worker.isRunning(),
    async start() {
      dispatcher.start();
      await worker.waitUntilReady();
    },
    async close() {
      await dispatcher.stop();
      await worker.close();
      await Promise.allSettled([...failures]);
      await queue.close();
      queueConnection.disconnect();
      workerConnection.disconnect();
    },
  };
}
