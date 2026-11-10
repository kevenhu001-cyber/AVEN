import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
const composeFile = resolve(root, 'infra/compose/compose.yaml');
const command = process.argv[2] ?? 'status';

if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);

const commands = {
  up: ['up', '-d', '--wait'],
  down: ['down'],
  reset: ['down', '--volumes'],
  status: ['ps'],
  logs: ['logs', '-f', '--tail=100'],
};
const composeArgs = commands[command];
if (!composeArgs) {
  console.error('Expected one of: up, down, reset, status, logs.');
  process.exit(1);
}
if (command === 'reset') {
  console.warn('Removing local PostgreSQL/Redis volumes. All development data will be lost.');
}

const result = spawnSync(
  'docker',
  ['compose', '--env-file', envFile, '-f', composeFile, ...composeArgs],
  { cwd: root, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
