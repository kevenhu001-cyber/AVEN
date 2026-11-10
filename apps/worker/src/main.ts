import { parseWorkerEnvironment } from '@aven/config/env';
import { createLogWriter } from '@aven/config/logger';
import { createWorker } from './worker';

const log = createLogWriter('worker');
async function bootstrap() {
  const env = parseWorkerEnvironment(process.env);
  const worker = await createWorker(
    { host: env.WORKER_HEALTH_HOST, port: env.WORKER_HEALTH_PORT },
    log,
  );
  log({ level: 'info', event: 'worker.started.foundation.no_consumers' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void worker.close().catch(() => {
        process.exitCode = 1;
      });
    });
  }
}
void bootstrap().catch(() => {
  log({ level: 'error', event: 'worker.startup_failed' });
  process.exitCode = 1;
});
