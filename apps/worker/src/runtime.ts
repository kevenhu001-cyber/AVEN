import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { redisUrl } from '@aven/config/env';
import type { LogWriter } from '@aven/config/logger';
import { createPool } from '@aven/database';
import {
  markReceiptDead,
  processSampleTask,
  type SampleTaskEvent,
  type SampleTaskResult,
} from '@aven/domain';
import { createWorkerReadinessRuntime, type ReadinessRuntime } from '@aven/service-health';
import { OutboxDispatcher } from './outbox.js';

export type WorkerRuntime = {
  readiness: ReadinessRuntime;
  dispatcher: OutboxDispatcher;
  queue: Queue<SampleTaskEvent, SampleTaskResult>;
  pool: ReturnType<typeof createPool>;
  start(): Promise<void>;
  close(): Promise<void>;
  isConsumerRunning(): boolean;
};

function createConnection(log: LogWriter, maxRetriesPerRequest: number | null): Redis {
  const connection = new Redis(redisUrl(), { maxRetriesPerRequest });
  connection.on('error', () => log({ level: 'error', event: 'worker.redis_error' }));
  return connection;
}

export function createWorkerRuntime(log: LogWriter): WorkerRuntime {
  const queueConnection = createConnection(log, 1);
  const workerConnection = createConnection(log, null);
  const pool = createPool('aven_worker', { max: 5 });
  const queue = new Queue<SampleTaskEvent, SampleTaskResult>('aven-sample', {
    connection: queueConnection,
  });
  const worker = new Worker<SampleTaskEvent, SampleTaskResult>(
    'aven-sample',
    async (job) => {
      return processSampleTask(pool, job.data, {
        attempt: job.attemptsMade + 1,
        leaseToken: String(job.id ?? job.data.id),
      });
    },
    { connection: workerConnection, concurrency: 1 },
  );
  worker.on('completed', (job) => {
    log({
      level: 'info',
      event: 'worker.job_completed',
      ...(job.id ? { job_id: job.id } : {}),
    });
  });
  worker.on('failed', (job, error) => {
    log({
      level: 'error',
      event: 'worker.job_failed',
      ...(job?.id ? { job_id: job.id } : {}),
      error_code: error.name,
    });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void markReceiptDead(pool, job.data.id, job.attemptsMade, error.name).catch(() => undefined);
    }
  });
  worker.on('error', () => log({ level: 'error', event: 'worker.queue_error' }));

  const dispatcher = new OutboxDispatcher(pool, queue, log);
  const readiness = createWorkerReadinessRuntime({ consumers: () => worker.isRunning() });

  return {
    readiness,
    dispatcher,
    queue,
    pool,
    async start() {
      dispatcher.start();
      await worker.waitUntilReady();
    },
    async close() {
      await dispatcher.stop();
      await worker.close();
      await queue.close();
      queueConnection.disconnect();
      workerConnection.disconnect();
      await pool.end().catch(() => undefined);
      await readiness.close();
    },
    isConsumerRunning() {
      return worker.isRunning();
    },
  };
}
