import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { LogWriter } from '@aven/config/logger';
import type { DatabasePool } from '@aven/database';
import { sampleTaskConsumer, type SampleTaskEvent, type SampleTaskResult } from '@aven/domain';

export type ClaimedEvent = {
  id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
};

export type OutboxDispatcherOptions = {
  leaseSeconds?: number;
  batchSize?: number;
  reconcileAfterSeconds?: number;
  enqueueTimeoutMs?: number;
  eventType?: string;
  enqueue?: (row: ClaimedEvent) => Promise<void>;
  reconcile?: () => Promise<number>;
};

const defaultLeaseSeconds = 30;
const defaultBatchSize = 10;
const defaultEnqueueTimeoutMs = 3000;
const sampleEventType = 'sample_task.created';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class OutboxDispatcher {
  private readonly instanceToken = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly eventType: string;

  constructor(
    private readonly pool: DatabasePool,
    private readonly queue: Queue<SampleTaskEvent, SampleTaskResult> | undefined,
    private readonly log: LogWriter,
    private readonly options: OutboxDispatcherOptions = {},
  ) {
    if (!queue && !options.enqueue) throw new Error('OUTBOX_QUEUE_REQUIRED');
    this.eventType = options.eventType ?? sampleEventType;
  }

  async dispatchOnce(
    fault: { crashAfterClaim?: boolean; crashAfterEnqueue?: boolean } = {},
  ): Promise<number> {
    const claimed = await this.pool.query<ClaimedEvent>(
      `WITH claimed AS (
         SELECT id
         FROM public.outbox_events
         WHERE (
             (status = 'pending' AND available_at <= now())
             OR (status = 'processing' AND lease_expires_at < now())
           )
           AND event_type = $4
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE public.outbox_events o
       SET status = 'processing',
           locked_at = now(),
           locked_by = $2,
           lease_expires_at = now() + make_interval(secs => $3::int),
           attempts = o.attempts + 1
       FROM claimed c
       WHERE o.id = c.id
       RETURNING o.id, o.event_type, o.payload, o.attempts`,
      [
        this.options.batchSize ?? defaultBatchSize,
        this.instanceToken,
        this.options.leaseSeconds ?? defaultLeaseSeconds,
        this.eventType,
      ],
    );
    if (claimed.rows.length > 0) {
      this.log({
        level: 'info',
        event: 'outbox.claimed',
        count: claimed.rows.length,
      });
    }
    if (fault.crashAfterClaim) throw new Error('OUTBOX_CRASH_AFTER_CLAIM');

    let dispatched = 0;
    for (const row of claimed.rows) {
      try {
        await this.enqueueRow(row);
        if (fault.crashAfterEnqueue) throw new Error('OUTBOX_CRASH_AFTER_ENQUEUE');
        const confirmed = await this.pool.query(
          `UPDATE public.outbox_events
           SET status = 'processed',
               processed_at = now(),
               locked_by = null,
               lease_expires_at = null
           WHERE id = $1
             AND status = 'processing'
             AND locked_by = $2
             AND lease_expires_at > now()`,
          [row.id, this.instanceToken],
        );
        if ((confirmed.rowCount ?? 0) === 0) {
          this.log({ level: 'warn', event: 'outbox.confirm_lost' });
        } else {
          dispatched += 1;
          this.log({ level: 'info', event: 'outbox.enqueued' });
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'OUTBOX_CRASH_AFTER_ENQUEUE' ||
            error.message === 'OUTBOX_CRASH_AFTER_CLAIM')
        ) {
          throw error;
        }
        await this.pool
          .query(
            `UPDATE public.outbox_events
             SET status = 'pending',
                 available_at = now() + interval '5 seconds',
                 locked_by = null,
                 lease_expires_at = null,
                 last_error = 'ENQUEUE_FAILED'
             WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
            [row.id, this.instanceToken],
          )
          .catch(() => undefined);
        this.log({ level: 'error', event: 'outbox.enqueue_failed' });
      }
    }
    return dispatched;
  }

  private async enqueueRow(row: ClaimedEvent): Promise<void> {
    await withTimeout(
      this.options.enqueue ? this.options.enqueue(row) : this.enqueueSampleTask(row),
      this.options.enqueueTimeoutMs ?? defaultEnqueueTimeoutMs,
      'ENQUEUE_TIMEOUT',
    );
  }

  private async enqueueSampleTask(row: ClaimedEvent): Promise<void> {
    if (!this.queue) throw new Error('OUTBOX_QUEUE_REQUIRED');
    const event: SampleTaskEvent = {
      id: row.id,
      eventType: 'sample_task.created',
      payload: row.payload as SampleTaskEvent['payload'],
    };
    await this.queue.add('sample-task', event, {
      jobId: row.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 500 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: false,
    });
  }

  async reconcile(): Promise<number> {
    if (this.options.reconcile) return this.options.reconcile();
    if (this.eventType !== sampleEventType) return 0;
    const rows = await this.pool.query<ClaimedEvent>(
      `SELECT o.id, o.event_type, o.payload, o.attempts
       FROM public.outbox_events o
       LEFT JOIN public.job_receipts r
         ON r.event_id = o.id AND r.consumer = $1
       WHERE o.status = 'processed'
         AND o.event_type = 'sample_task.created'
         AND o.processed_at < now() - make_interval(secs => $3::int)
         AND (
           r.event_id IS NULL
           OR (r.status IN ('running', 'failed', 'unknown')
               AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now()))
         )
       ORDER BY o.processed_at
       LIMIT $2`,
      [
        sampleTaskConsumer,
        this.options.batchSize ?? defaultBatchSize,
        this.options.reconcileAfterSeconds ?? 30,
      ],
    );
    let replayed = 0;
    for (const row of rows.rows) {
      try {
        if (!this.queue) throw new Error('OUTBOX_QUEUE_REQUIRED');
        await withTimeout(
          this.queue.add(
            'sample-task',
            {
              id: row.id,
              eventType: 'sample_task.created',
              payload: row.payload as SampleTaskEvent['payload'],
            },
            {
              jobId: `${row.id}-reconcile`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 500 },
              removeOnComplete: { age: 3600, count: 1000 },
              removeOnFail: false,
            },
          ),
          this.options.enqueueTimeoutMs ?? defaultEnqueueTimeoutMs,
          'ENQUEUE_TIMEOUT',
        );
        replayed += 1;
        this.log({ level: 'warn', event: 'outbox.reconciled' });
      } catch {
        this.log({ level: 'error', event: 'outbox.reconcile_failed' });
      }
    }
    return replayed;
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.dispatchOnce();
        await this.reconcile();
      } catch {
        this.log({ level: 'error', event: 'outbox.tick_failed' });
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
