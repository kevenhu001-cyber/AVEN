import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Launcher for the Docker-free mock mode: the Web app serves labelled synthetic API
// data from its own route handlers (apps/web/src/mocks) instead of proxying to the
// real API. No Postgres, Redis or Worker involved; nothing here is production-usable.
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const command = args.includes('--start') ? 'start' : 'dev';
const extra = command === 'start' ? ['--port', process.env.MOCK_WEB_PORT ?? '3100'] : [];

const child = spawn('pnpm', ['--filter', '@aven/web', command, ...extra], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    AVEN_WEB_MOCK: '1',
    NEXT_TELEMETRY_DISABLED: '1',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
