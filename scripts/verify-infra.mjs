import { existsSync } from 'node:fs';
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

const required = [
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'AVEN_MIGRATOR_PASSWORD',
  'AVEN_APP_PASSWORD',
  'AVEN_WORKER_PASSWORD',
  'AVEN_AUTH_PASSWORD',
  'REDIS_PASSWORD',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment fields: ${missing.join(', ')}`);
  process.exit(1);
}

function compose(args, options = {}) {
  return spawnSync('docker', ['compose', '--env-file', envFile, '-f', composeFile, ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function psql(user, password, database, sql) {
  return compose([
    'exec',
    '-T',
    '-e',
    `PGPASSWORD=${password}`,
    'postgres',
    'psql',
    '-h',
    '127.0.0.1',
    '-U',
    user,
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-tAc',
    sql,
  ]);
}

let failed = 0;
function check(name, result, predicate, detail = '') {
  const ok = predicate(result);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n')[0];
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail || output}`}`);
  if (!ok) failed += 1;
}
const succeeded = (result) => result.status === 0;
const failedRequest = (result) => result.status !== 0;
const outputIs = (value) => (result) => result.status === 0 && result.stdout.trim() === value;
const outputIncludes = (value) => (result) =>
  `${result.stdout ?? ''}${result.stderr ?? ''}`.includes(value);

const db = process.env.POSTGRES_DB;
const app = process.env.AVEN_APP_PASSWORD;
const migrator = process.env.AVEN_MIGRATOR_PASSWORD;

check(
  'PostgreSQL accepts the migrator connection',
  psql('aven_migrator', migrator, db, 'SELECT current_user;'),
  outputIs('aven_migrator'),
);
check(
  'PostgreSQL accepts the app connection',
  psql('aven_app', app, db, 'SELECT current_user;'),
  outputIs('aven_app'),
);
check(
  'app role has no superuser, createdb, createrole, or bypassrls',
  psql(
    'aven_app',
    app,
    db,
    "SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'aven_app';",
  ),
  outputIs('f|f|f|f'),
);
check(
  'app role cannot create DDL in public schema',
  psql('aven_app', app, db, 'CREATE TABLE public.aven_ddl_probe (id integer);'),
  failedRequest,
);
check(
  'app role cannot SET ROLE to the migrator',
  psql('aven_app', app, db, 'SET ROLE aven_migrator;'),
  failedRequest,
);
check(
  'app role cannot read pg_authid',
  psql('aven_app', app, db, 'SELECT * FROM pg_authid LIMIT 1;'),
  failedRequest,
);
check(
  'app role cannot create a database',
  psql('aven_app', app, db, 'CREATE DATABASE aven_probe;'),
  failedRequest,
);
check(
  'app role cannot connect to the postgres maintenance database',
  psql('aven_app', app, 'postgres', 'SELECT 1;'),
  failedRequest,
);
check(
  'app role cannot create the optional vector extension',
  psql('aven_app', app, db, 'CREATE EXTENSION IF NOT EXISTS vector;'),
  failedRequest,
);
check(
  'migrator can create and roll back a table',
  psql(
    'aven_migrator',
    migrator,
    db,
    'BEGIN; CREATE TABLE public.aven_migration_probe (id integer); ROLLBACK;',
  ),
  succeeded,
);
check(
  'function owner is NOLOGIN',
  psql(
    'aven_migrator',
    migrator,
    db,
    "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'aven_function_owner';",
  ),
  outputIs('f'),
);
check(
  'runtime roles have no explicit memberships',
  psql(
    'aven_migrator',
    migrator,
    db,
    "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid WHERE r.rolname IN ('aven_app', 'aven_worker', 'aven_auth') OR g.rolname IN ('aven_app', 'aven_worker', 'aven_auth');",
  ),
  outputIs('0'),
);
check(
  'migrator is a member only of the function owner',
  psql(
    'aven_migrator',
    migrator,
    db,
    "SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid WHERE r.rolname = 'aven_migrator';",
  ),
  outputIs('aven_function_owner'),
);
check(
  'migrator can SET ROLE to the function owner',
  psql('aven_migrator', migrator, db, 'SET ROLE aven_function_owner; RESET ROLE;'),
  succeeded,
);
check(
  'test database exists',
  psql(
    'aven_migrator',
    migrator,
    db,
    "SELECT datname FROM pg_database WHERE datname = 'aven_test';",
  ),
  outputIs('aven_test'),
);
check(
  'optional extensions are not preinstalled',
  psql(
    'aven_migrator',
    migrator,
    db,
    "SELECT count(*) FROM pg_extension WHERE extname IN ('vector', 'postgis');",
  ),
  outputIs('0'),
);

const redisPing = compose([
  'exec',
  '-T',
  'redis',
  'sh',
  '-c',
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping',
]);
check('Redis accepts the configured password', redisPing, outputIs('PONG'));
check(
  'Redis rejects unauthenticated commands',
  compose(['exec', '-T', 'redis', 'redis-cli', 'ping']),
  outputIncludes('NOAUTH'),
);
check(
  'Redis persistence is enabled',
  compose([
    'exec',
    '-T',
    'redis',
    'sh',
    '-c',
    'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --raw CONFIG GET appendonly',
  ]),
  outputIncludes('yes'),
);
check(
  'Redis does not evict task keys',
  compose([
    'exec',
    '-T',
    'redis',
    'sh',
    '-c',
    'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --raw CONFIG GET maxmemory-policy',
  ]),
  outputIncludes('noeviction'),
);

if (failed) {
  console.error(`\n${failed} infrastructure check(s) failed.`);
  process.exit(1);
}
console.log('\nAll infrastructure checks passed.');
