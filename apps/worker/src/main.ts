import { parseWorkerEnvironment } from '@aven/config/env';
import { createLogWriter } from '@aven/config/logger';
import { createWorker } from './worker';
import { createWorkerRuntime } from './runtime';

const log = createLogWriter('worker');
async function bootstrap() {
  const env = parseWorkerEnvironment(process.env);
  const runtime = createWorkerRuntime(log);
  const worker = await createWorker(
    { host: env.WORKER_HEALTH_HOST, port: env.WORKER_HEALTH_PORT },
    log,
    runtime.readiness,
  );
  void runtime.start().catch((error: unknown) => {
    log({
      level: 'error',
      event: 'worker.runtime_start_failed',
      error_code: error instanceof Error ? error.name : 'UNKNOWN',
    });
  });
  log({ level: 'info', event: 'worker.started.foundation.outbox_sample' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void (async () => {
        await worker.close();
        await runtime.close();
      })().catch(() => {
        process.exitCode = 1;
      });
    });
  }
}
void bootstrap().catch(() => {
  log({ level: 'error', event: 'worker.startup_failed' });
  process.exitCode = 1;
});
