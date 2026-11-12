import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
const composeFile = resolve(root, 'infra/compose/compose.yaml');
if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);

const testDatabase = 'aven_test';
const testEnv = { ...process.env, POSTGRES_DB: testDatabase };

function compose(args) {
  return spawnSync('docker', ['compose', '--env-file', envFile, '-f', composeFile, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function psql(database, sql) {
  const result = compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    process.env.POSTGRES_USER,
    '-d',
    database,
    '-c',
    sql,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr || `psql failed for ${database}`);
  }
}

function run(label, command, args, env = process.env) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
}

try {
  psql('postgres', `DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  psql('postgres', `CREATE DATABASE ${testDatabase} OWNER aven_migrator`);
  psql(
    'postgres',
    `REVOKE ALL ON DATABASE ${testDatabase} FROM PUBLIC;
     GRANT CONNECT ON DATABASE ${testDatabase} TO aven_migrator, aven_app, aven_worker, aven_auth;
     GRANT TEMPORARY ON DATABASE ${testDatabase} TO aven_migrator;`,
  );
  psql(
    testDatabase,
    `REVOKE ALL ON SCHEMA public FROM PUBLIC;
     GRANT USAGE, CREATE ON SCHEMA public TO aven_migrator;
     GRANT USAGE ON SCHEMA public TO aven_app, aven_worker, aven_auth, aven_function_owner;`,
  );

  run(
    'empty database: apply first migration only',
    'pnpm',
    ['exec', 'tsx', 'packages/database/src/migrate.ts', '--to', '0001_identity_organization'],
    testEnv,
  );
  run(
    'existing database: upgrade through personal connection consent',
    'pnpm',
    ['exec', 'tsx', 'packages/database/src/migrate.ts', '--to', '0032_connection_complete_consent'],
    testEnv,
  );
  psql(
    testDatabase,
    readFileSync(resolve(root, 'scripts/fixtures/connection-retention-upgrade.sql'), 'utf8'),
  );
  run(
    'existing database: upgrade retention with legacy private snapshots',
    'pnpm',
    ['exec', 'tsx', 'packages/database/src/migrate.ts'],
    testEnv,
  );
  psql(
    testDatabase,
    readFileSync(resolve(root, 'scripts/fixtures/connection-retention-upgraded.sql'), 'utf8'),
  );
  console.log(
    'PASS  retention upgrade conservatively timestamps stale data and preserves active data',
  );
  run('seed development data', 'pnpm', ['exec', 'tsx', 'packages/database/src/seed.ts'], testEnv);
  run('seed is idempotent', 'pnpm', ['exec', 'tsx', 'packages/database/src/seed.ts'], testEnv);
  run(
    'migrations are idempotent',
    'pnpm',
    ['exec', 'tsx', 'packages/database/src/migrate.ts'],
    testEnv,
  );
  run(
    'verify schema, RLS, and seed',
    'pnpm',
    ['exec', 'tsx', 'packages/database/src/verify.ts'],
    testEnv,
  );

  console.log(`\nDatabase test harness passed against ${testDatabase}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database test harness failed.');
  process.exitCode = 1;
}
