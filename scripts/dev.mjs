import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const app = process.argv[2];
if (!['web', 'api', 'worker', 'mobile'].includes(app)) {
  throw new Error('Expected web, api, worker, or mobile.');
}
const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) loadEnvFile(envFile);
const child = spawn('pnpm', ['--filter', `@aven/${app}`, 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', () => {
  console.error('Unable to launch pnpm. Enable the pinned Corepack package manager first.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
