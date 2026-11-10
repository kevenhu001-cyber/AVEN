import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const target = process.argv[2];
const root = resolve(import.meta.dirname, '..');
const commands = {
  api: ['pnpm', ['--filter', '@aven/api', 'start']],
  web: ['pnpm', ['--filter', '@aven/web', 'start', '--port', '3100']],
};
const command = commands[target];
if (!command) throw new Error('Expected api or web.');
const child = spawn(command[0], command[1], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3001',
    API_INTERNAL_URL: 'http://127.0.0.1:3001',
    WEB_ORIGIN: 'http://127.0.0.1:3100',
    NEXT_TELEMETRY_DISABLED: '1',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
