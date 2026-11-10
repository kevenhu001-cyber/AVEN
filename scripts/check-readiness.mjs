import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);
if (!existsSync(resolve(root, 'apps/api/dist/main.js'))) {
  console.error('Missing built API. Run: corepack pnpm build');
  process.exit(1);
}

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed += 1;
}

function start(script, env) {
  return spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function request(url, timeoutMs = 2500) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : 'request failed' };
  }
}

async function waitFor(url, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await request(url);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

async function main() {
  const api = start('apps/api/dist/main.js', {
    APP_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    WEB_ORIGIN: 'http://127.0.0.1:3101',
  });
  try {
    const live = await waitFor('http://127.0.0.1:3101/health/live', (r) => r.status === 200);
    check('API liveness responds while dependencies are configured', live.status === 200);
    const ready = await waitFor(
      'http://127.0.0.1:3101/health/ready',
      (r) => r.status === 200 || r.status === 503,
    );
    check(
      'API readiness reaches the dependency probe',
      ready.status === 200,
      JSON.stringify(ready),
    );
    check(
      'API readiness reports database, Redis, and migrations',
      ready.body?.checks?.database === true &&
        ready.body?.checks?.redis === true &&
        ready.body?.checks?.migrations === true,
      JSON.stringify(ready.body),
    );
    check(
      'API readiness does not expose connection details',
      !JSON.stringify(ready.body ?? {}).includes('postgres') &&
        !JSON.stringify(ready.body ?? {}).includes('redis://'),
    );
  } finally {
    await stop(api);
  }

  const brokenApi = start('apps/api/dist/main.js', {
    APP_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3102',
    WEB_ORIGIN: 'http://127.0.0.1:3102',
    REDIS_PORT: '6399',
  });
  try {
    const ready = await waitFor('http://127.0.0.1:3102/health/ready', (r) => r.status === 503);
    check('API readiness fails when Redis is unreachable', ready.status === 503);
    check(
      'failed readiness uses the uniform retryable error',
      ready.body?.error?.code === 'SERVICE_NOT_READY' && ready.body?.error?.retryable === true,
      JSON.stringify(ready.body),
    );
  } finally {
    await stop(brokenApi);
  }

  const worker = start('apps/worker/dist/main.js', {
    APP_ENV: 'test',
    WORKER_HEALTH_HOST: '127.0.0.1',
    WORKER_HEALTH_PORT: '3103',
  });
  try {
    const live = await waitFor('http://127.0.0.1:3103/health/live', (r) => r.status === 200);
    check('worker liveness responds without claiming consumers', live.status === 200);
    const ready = await waitFor(
      'http://127.0.0.1:3103/health/ready',
      (r) => r.status === 503 || r.status === 200,
    );
    check(
      'worker readiness reports a running consumer',
      ready.status === 200 && ready.body?.checks?.consumers === true,
      JSON.stringify(ready),
    );
    check(
      'worker readiness reports dependency checks',
      ready.body?.checks?.database === true && ready.body?.checks?.redis === true,
      JSON.stringify(ready.body),
    );
  } finally {
    await stop(worker);
  }

  if (failed) {
    console.error(`\n${failed} readiness check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll readiness checks passed.');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Readiness check failed.');
  process.exitCode = 1;
});
