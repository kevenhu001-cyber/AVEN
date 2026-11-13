import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { redisUrl } from '@aven/config/env';
import type { LogWriter } from '@aven/config/logger';
import { createAIProvider, parseAIProviderConfig } from '@aven/ai-core';
import { userProviderForRun } from './user-provider.js';
import { authorizeExternalRun } from './external-preflight.js';
import { createApplicationPool, createPool } from '@aven/database';
import {
  markReceiptDead,
  processSampleTask,
  type SampleTaskEvent,
  type SampleTaskResult,
} from '@aven/domain';
import { createWorkerReadinessRuntime, type ReadinessRuntime } from '@aven/service-health';
import { processAgentRun, type AgentRunProcessResult } from './agent.js';
import { OutboxDispatcher } from './outbox.js';
import { createNotificationRuntime } from './notification.js';

export type AgentRunJob = {
  runId: string;
};

export type WorkerRuntime = {
  readiness: ReadinessRuntime;
  dispatcher: OutboxDispatcher;
  agentDispatcher: OutboxDispatcher;
  queue: Queue<SampleTaskEvent, SampleTaskResult>;
  agentQueue: Queue<AgentRunJob, AgentRunProcessResult>;
  notifications: ReturnType<typeof createNotificationRuntime>;
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
  const agentWorkerConnection = createConnection(log, null);
  const pool = createPool('aven_worker', { max: 5 });
  const externalReadPool = createApplicationPool({ max: 2 });
  const provider = createAIProvider(parseAIProviderConfig(process.env));

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

  const agentQueue = new Queue<AgentRunJob, AgentRunProcessResult>('aven-agent', {
    connection: queueConnection,
  });
  const agentWorker = new Worker<AgentRunJob, AgentRunProcessResult>(
    'aven-agent',
    async (job) =>
      processAgentRun(pool, job.data.runId, provider, log, {
        userProvider: (runId) => userProviderForRun(pool, runId),
        authorizeExternal: (identity) => authorizeExternalRun(externalReadPool, identity),
      }),
    { connection: agentWorkerConnection, concurrency: 1 },
  );
  agentWorker.on('completed', (job) => {
    log({
      level: 'info',
      event: 'agent.job_completed',
      run_id: job.data.runId,
      ...(job.id ? { job_id: job.id } : {}),
    });
  });
  agentWorker.on('failed', (job, error) => {
    log({
      level: 'error',
      event: 'agent.job_failed',
      ...(job?.data.runId ? { run_id: job.data.runId } : {}),
      ...(job?.id ? { job_id: job.id } : {}),
      error_code: error.name,
    });
  });
  agentWorker.on('error', () => log({ level: 'error', event: 'agent.queue_error' }));

  const dispatcher = new OutboxDispatcher(pool, queue, log);
  const agentDispatcher = new OutboxDispatcher(pool, undefined, log, {
    eventType: 'agent.run.requested',
    enqueue: async (row) => {
      const payload = row.payload as { runId?: unknown };
      if (typeof payload.runId !== 'string') throw new Error('INVALID_AGENT_EVENT');
      await agentQueue.add(
        'agent-run',
        { runId: payload.runId },
        {
          jobId: row.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 500 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: false,
        },
      );
    },
  });
  const notifications = createNotificationRuntime(pool, log);
  const readiness = createWorkerReadinessRuntime({
    consumers: () => worker.isRunning() && agentWorker.isRunning() && notifications.isRunning(),
  });

  return {
    readiness,
    dispatcher,
    agentDispatcher,
    queue,
    agentQueue,
    notifications,
    pool,
    async start() {
      dispatcher.start();
      agentDispatcher.start();
      await worker.waitUntilReady();
      await agentWorker.waitUntilReady();
      await notifications.start();
    },
    async close() {
      await dispatcher.stop();
      await agentDispatcher.stop();
      await notifications.close();
      await worker.close();
      await agentWorker.close();
      await queue.close();
      await agentQueue.close();
      queueConnection.disconnect();
      workerConnection.disconnect();
      agentWorkerConnection.disconnect();
      await externalReadPool.end().catch(() => undefined);
      await pool.end().catch(() => undefined);
      await readiness.close();
    },
    isConsumerRunning() {
      return worker.isRunning() && agentWorker.isRunning() && notifications.isRunning();
    },
  };
}
