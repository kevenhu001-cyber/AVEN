import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
const port = process.env.POSTGRES_PORT ?? '55432';
const database = process.env.POSTGRES_DB ?? 'aven';

export type DatabaseRole = 'aven_migrator' | 'aven_app' | 'aven_worker' | 'aven_auth';

const passwordVariables: Record<DatabaseRole, string> = {
  aven_migrator: 'AVEN_MIGRATOR_PASSWORD',
  aven_app: 'AVEN_APP_PASSWORD',
  aven_worker: 'AVEN_WORKER_PASSWORD',
  aven_auth: 'AVEN_AUTH_PASSWORD',
};

export function databaseUrlFor(role: DatabaseRole, databaseName = database): string {
  const password = process.env[passwordVariables[role]];
  if (!password) {
    throw new Error(`Missing ${passwordVariables[role]} for ${role}.`);
  }
  return `postgres://${role}:${encodeURIComponent(password)}@${host}:${port}/${databaseName}`;
}

export function migrationDatabaseUrl(): string {
  return process.env.MIGRATION_DATABASE_URL ?? databaseUrlFor('aven_migrator');
}

export function applicationDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? databaseUrlFor('aven_app');
}

export function testDatabaseUrl(role: DatabaseRole = 'aven_migrator'): string {
  return databaseUrlFor(role, process.env.POSTGRES_TEST_DB ?? 'aven_test');
}
