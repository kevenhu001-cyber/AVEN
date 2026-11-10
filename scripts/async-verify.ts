import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { LogEntry } from '@aven/config/logger';
import { createPool } from '@aven/database';
import { createSampleTask, sampleTaskConsumer, type SampleTaskEvent } from '@aven/domain';
import { createWorkerRuntime } from '../apps/worker/src/runtime.js';
import { OutboxDispatcher } from '../apps/worker/src/outbox.js';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
const composeFile = resolve(root, 'infra/compose/compose.yaml');
if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed += 1;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 20_000,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) return result;
    await sleep(200);
  }
  return undefined;
}
function compose(args: string[]) {
  return spawnSync('docker', ['compose', '--env-file', envFile, '-f', composeFile, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

async function main(): Promise<void> {
  const logs: LogEntry[] = [];
  const log = (entry: LogEntry) => logs.push(entry);
  const migrator = createPool('aven_migrator', { max: 2 });
  const app = createPool('aven_app', { max: 2 });
  const runtime = createWorkerRuntime(log);
  const faultDispatcher = new OutboxDispatcher(runtime.pool, runtime.queue, log, {
    leaseSeconds: 1,
    reconcileAfterSeconds: 0,
  });
  const redisDispatcher = new OutboxDispatcher(runtime.pool, runtime.queue, log, {
    leaseSeconds: 30,
    reconcileAfterSeconds: 0,
  });

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const result = await migrator.query<{ count: string }>(sql, params);
    return Number(result.rows[0]?.count ?? -1);
  }
  async function waitForReceipt(eventId: string, status: string, timeoutMs = 20_000) {
    return waitFor(async () => {
      const result = await migrator.query<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM public.job_receipts WHERE event_id = $1 AND consumer = $2',
        [eventId, sampleTaskConsumer],
      );
      return result.rows[0]?.status === status ? result.rows[0] : undefined;
    }, timeoutMs);
  }

  try {
    await migrator.query('DELETE FROM public.job_receipts');
    await migrator.query('DELETE FROM app.sample_task_results');
    await migrator.query('DELETE FROM app.sample_external_effects');
    await migrator.query('DELETE FROM public.outbox_events');
    await migrator.query('DELETE FROM app.sample_tasks');
    await runtime.queue.obliterate({ force: true }).catch(() => undefined);
    await runtime.start();

    const success = await createSampleTask(app, { title: 'success' });
    const successReceipt = await waitForReceipt(success.eventId, 'succeeded');
    check('successful task reaches a succeeded receipt', successReceipt !== undefined);
    const successOutbox = await migrator.query<{ status: string }>(
      'SELECT status FROM public.outbox_events WHERE id = $1',
      [success.eventId],
    );
    check('successful task outbox is processed', successOutbox.rows[0]?.status === 'processed');
    check(
      'successful task writes one result',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_task_results WHERE event_id = $1',
        [success.eventId],
      )) === 1,
    );
    check(
      'successful task writes one external effect',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_external_effects WHERE idempotency_key = $1',
        [`${success.eventId}:${sampleTaskConsumer}`],
      )) === 1,
    );

    const successEvent = await migrator.query<{
      id: string;
      payload: SampleTaskEvent['payload'];
    }>('SELECT id, payload FROM public.outbox_events WHERE id = $1', [success.eventId]);
    const eventRow = successEvent.rows[0];
    if (eventRow) {
      await runtime.queue.add(
        'sample-task',
        { id: eventRow.id, eventType: 'sample_task.created', payload: eventRow.payload },
        { jobId: `${eventRow.id}-duplicate`, attempts: 1 },
      );
      await sleep(800);
    }
    check(
      'duplicate delivery does not duplicate the result',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_task_results WHERE event_id = $1',
        [success.eventId],
      )) === 1,
    );
    check(
      'duplicate delivery does not duplicate the external effect',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_external_effects WHERE idempotency_key = $1',
        [`${success.eventId}:${sampleTaskConsumer}`],
      )) === 1,
    );

    const unknown = await createSampleTask(app, { title: 'unknown', simulate: 'unknown' });
    const unknownReceipt = await waitForReceipt(unknown.eventId, 'succeeded');
    check('unknown external result is reconciled on retry', unknownReceipt !== undefined);
    check(
      'unknown result retries at least once',
      (unknownReceipt?.attempts ?? 0) >= 2,
      JSON.stringify(unknownReceipt),
    );
    check(
      'unknown result writes one external effect',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_external_effects WHERE idempotency_key = $1',
        [`${unknown.eventId}:${sampleTaskConsumer}`],
      )) === 1,
    );

    const dead = await createSampleTask(app, { title: 'dead', simulate: 'fail' });
    const deadReceipt = await waitForReceipt(dead.eventId, 'dead', 30_000);
    check('permanent failure reaches a dead receipt', deadReceipt !== undefined);
    check(
      'dead receipt records three attempts',
      deadReceipt?.attempts === 3,
      JSON.stringify(deadReceipt),
    );
    check(
      'dead task writes no result',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_task_results WHERE event_id = $1',
        [dead.eventId],
      )) === 0,
    );

    await migrator.query('BEGIN');
    try {
      const task = await migrator.query<{ id: string }>(
        "INSERT INTO app.sample_tasks (title) VALUES ('rollback probe') RETURNING id",
      );
      const taskId = task.rows[0]?.id;
      await migrator.query(
        `INSERT INTO public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('rollback_probe', $1, 'sample_task.created', $2)`,
        [taskId, { taskId, title: 'rollback probe' }],
      );
    } finally {
      await migrator.query('ROLLBACK');
    }
    check(
      'rolled-back business write leaves no outbox event',
      (await count(
        "SELECT count(*)::text AS count FROM public.outbox_events WHERE aggregate_type = 'rollback_probe'",
      )) === 0,
    );

    await runtime.dispatcher.stop();
    const lease = await createSampleTask(app, { title: 'lease expiry' });
    let crashed = false;
    try {
      await faultDispatcher.dispatchOnce({ crashAfterClaim: true });
    } catch {
      crashed = true;
    }
    check('dispatcher can crash after claiming', crashed);
    const leased = await migrator.query<{ status: string; lease_expires_at: string | null }>(
      'SELECT status, lease_expires_at FROM public.outbox_events WHERE id = $1',
      [lease.eventId],
    );
    check(
      'crashed claim leaves a processing lease',
      leased.rows[0]?.status === 'processing' && leased.rows[0]?.lease_expires_at !== null,
    );
    await sleep(1300);
    await faultDispatcher.dispatchOnce();
    const recovered = await migrator.query<{ status: string }>(
      'SELECT status FROM public.outbox_events WHERE id = $1',
      [lease.eventId],
    );
    check('expired lease is reclaimed and processed', recovered.rows[0]?.status === 'processed');
    check(
      'lease recovery reaches a succeeded receipt',
      (await waitForReceipt(lease.eventId, 'succeeded')) !== undefined,
    );

    const enqueueCrash = await createSampleTask(app, { title: 'enqueue crash' });
    crashed = false;
    try {
      await faultDispatcher.dispatchOnce({ crashAfterEnqueue: true });
    } catch {
      crashed = true;
    }
    check('dispatcher can crash after enqueue', crashed);
    const enqueued = await migrator.query<{ status: string }>(
      'SELECT status FROM public.outbox_events WHERE id = $1',
      [enqueueCrash.eventId],
    );
    check(
      'crash after enqueue leaves the event processing',
      enqueued.rows[0]?.status === 'processing',
    );
    await sleep(1300);
    await faultDispatcher.dispatchOnce();
    check(
      'event is confirmed after enqueue crash recovery',
      (await waitForReceipt(enqueueCrash.eventId, 'succeeded')) !== undefined,
    );
    check(
      'enqueue crash does not duplicate the external effect',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_external_effects WHERE idempotency_key = $1',
        [`${enqueueCrash.eventId}:${sampleTaskConsumer}`],
      )) === 1,
    );

    const reconcileEventId = randomUUID();
    const reconcileTaskId = randomUUID();
    await migrator.query(
      `INSERT INTO public.outbox_events
         (id, aggregate_type, aggregate_id, event_type, payload, status, processed_at)
       VALUES ($1, 'sample_task', $2, 'sample_task.created', $3, 'processed', now())`,
      [reconcileEventId, reconcileTaskId, { taskId: reconcileTaskId, title: 'reconcile' }],
    );
    check(
      'processed event without a receipt is reconciled',
      (await faultDispatcher.reconcile()) >= 1,
    );
    check(
      'reconciled event reaches a succeeded receipt',
      (await waitForReceipt(reconcileEventId, 'succeeded')) !== undefined,
    );

    const redisRestart = await createSampleTask(app, { title: 'redis restart' });
    const stopped = compose(['stop', 'redis']);
    check('Redis can be stopped for fault injection', stopped.status === 0);
    await redisDispatcher.dispatchOnce().catch(() => undefined);
    const pending = await migrator.query<{ status: string; last_error: string | null }>(
      'SELECT status, last_error FROM public.outbox_events WHERE id = $1',
      [redisRestart.eventId],
    );
    check(
      'enqueue failure returns the event to pending',
      pending.rows[0]?.status === 'pending' && pending.rows[0]?.last_error === 'ENQUEUE_FAILED',
      JSON.stringify(pending.rows[0]),
    );
    const started = compose(['up', '-d', '--wait', 'redis']);
    check('Redis restarts', started.status === 0);
    const redelivered = await waitFor(async () => {
      try {
        const count = await redisDispatcher.dispatchOnce();
        return count > 0 ? count : undefined;
      } catch {
        return undefined;
      }
    }, 20_000);
    check('outbox redelivers after Redis restart', redelivered !== undefined);
    check(
      'Redis restart task reaches a succeeded receipt',
      (await waitForReceipt(redisRestart.eventId, 'succeeded', 30_000)) !== undefined,
    );
    check(
      'Redis restart does not duplicate the external effect',
      (await count(
        'SELECT count(*)::text AS count FROM app.sample_external_effects WHERE idempotency_key = $1',
        [`${redisRestart.eventId}:${sampleTaskConsumer}`],
      )) === 1,
    );
  } finally {
    await runtime.close().catch(() => undefined);
    await faultDispatcher.stop().catch(() => undefined);
    await app.end().catch(() => undefined);
    await migrator.end().catch(() => undefined);
  }

  if (failed) {
    console.error(`\n${failed} async reliability check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll async reliability checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Async reliability check failed.');
  process.exitCode = 1;
});
