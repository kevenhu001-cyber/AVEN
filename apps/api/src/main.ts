import 'reflect-metadata';
import { parseApiEnvironment } from '@aven/config/env';
import { createLogWriter } from '@aven/config/logger';
import { createApiApplication } from './app';

const log = createLogWriter('api');
async function bootstrap() {
  const env = parseApiEnvironment(process.env);
  const app = await createApiApplication(env, log);
  await app.listen(env.API_PORT, env.API_HOST);
  log({ level: 'info', event: 'api.started.foundation' });
}
void bootstrap().catch(() => {
  log({ level: 'error', event: 'api.startup_failed' });
  process.exitCode = 1;
});
