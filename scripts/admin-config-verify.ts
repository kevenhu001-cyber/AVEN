import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createPool, databaseUrlFor } from '../packages/database/dist/index.js';

// Dedicated ephemeral database; never grant test administrator roles in a working database.
const name = `aven_admin_verify_${Date.now()}`;
const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/compose/compose.yaml',
  'exec',
  '-T',
  'postgres',
  'psql',
  '-v',
  'ON_ERROR_STOP=1',
  '-U',
  process.env.POSTGRES_USER ?? 'aven_bootstrap',
];
function bootstrap(db: string, sql: string) {
  execFileSync('docker', [...compose, '-d', db, '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
}
let checks = 0;
function check(value: unknown) {
  assert.ok(value);
  checks++;
}
bootstrap('postgres', `CREATE DATABASE ${name} OWNER aven_migrator`);
const migrator = createPool('aven_migrator', {
  connectionString: databaseUrlFor('aven_migrator', name),
});
const app = createPool('aven_app', { connectionString: databaseUrlFor('aven_app', name) });
try {
  bootstrap(
    name,
    `REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE,CREATE ON SCHEMA public TO aven_migrator; GRANT USAGE ON SCHEMA public TO aven_app,aven_worker,aven_auth,aven_function_owner;`,
  );
  bootstrap(
    'postgres',
    `REVOKE ALL ON DATABASE ${name} FROM PUBLIC; GRANT CONNECT ON DATABASE ${name} TO aven_migrator,aven_app,aven_auth,aven_worker;`,
  );
  await migrator.query(
    'CREATE SCHEMA app; CREATE TABLE app.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now(),execution_ms integer NOT NULL)',
  );
  for (const file of readdirSync('packages/database/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await migrator.query(readFileSync(`packages/database/migrations/${file}`, 'utf8'));
  }
  const owner = randomUUID(),
    other = randomUUID();
  for (const id of [owner, other]) {
    await migrator.query(
      "INSERT INTO public.principals(id,type,display_name) VALUES($1,'user','Synthetic verification')",
      [id],
    );
    await migrator.query('INSERT INTO public.users(id) VALUES($1)', [id]);
  }
  await migrator.query(
    "INSERT INTO public.platform_role_assignments(user_id,role) VALUES($1,'platform_admin')",
    [owner],
  );
  async function call(id: string | undefined, sql: string, args: unknown[] = []) {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      if (id)
        await client.query(
          "SELECT set_config('app.user_id',$1,true),set_config('app.principal_id',$1,true)",
          [id],
        );
      const result = await client.query(sql, args);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await assert.rejects(call(undefined, 'SELECT * FROM app.get_platform_configurations()'));
  checks++;
  await assert.rejects(call(other, 'SELECT * FROM app.get_platform_configurations()'));
  checks++;
  const save = 'SELECT * FROM app.save_platform_configuration($1,$2,$3,$4,$5)';
  const args = [
    'model',
    'https://synthetic.example.test/v1',
    'synthetic-model',
    'synthetic-encrypted',
    0,
  ];
  await assert.rejects(call(other, save, args));
  checks++;
  check((await call(owner, save, args)).rows[0]?.version === 1);
  await assert.rejects(call(owner, save, args));
  checks++;
  check((await call(owner, save, [...args.slice(0, 4), 1])).rows[0]?.version === 2);
  const metadata = (await call(owner, 'SELECT * FROM app.get_platform_configurations()')).rows[0];
  check(!('encrypted_key' in metadata));
  await assert.rejects(call(owner, 'SELECT encrypted_key FROM public.platform_configurations'));
  checks++;
  check(
    (await migrator.query('SELECT count(*)::int AS n FROM public.platform_configuration_events'))
      .rows[0]?.n === 2,
  );
  await assert.rejects(call(owner, 'DELETE FROM public.platform_configuration_events'));
  checks++;
  await call(
    owner,
    "INSERT INTO public.open_connector_connections(user_id,service,request_id,status,expires_at) VALUES($1,'gmail','synthetic-request','pending',now()+interval '1 hour')",
    [owner],
  );
  check((await call(other, 'SELECT * FROM public.open_connector_connections')).rows.length === 0);
  await assert.rejects(
    call(
      other,
      "INSERT INTO public.open_connector_connections(user_id,service,request_id,status,expires_at) VALUES($1,'gmail','forged','pending',now())",
      [owner],
    ),
  );
  checks++;
  await call(
    other,
    "UPDATE public.open_connector_connections SET status='connected' WHERE user_id=$1",
    [owner],
  );
  check(
    (await call(owner, 'SELECT status FROM public.open_connector_connections')).rows[0]?.status ===
      'pending',
  );
  await migrator.query(
    "UPDATE public.platform_role_assignments SET status='revoked' WHERE user_id=$1",
    [owner],
  );
  await assert.rejects(call(owner, 'SELECT * FROM app.get_platform_configurations()'));
  checks++;
  const rls = await migrator.query(
    "SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('platform_configurations','platform_configuration_events','open_connector_connections')",
  );
  check(rls.rows.length === 3 && rls.rows.every((r) => r.relforcerowsecurity));
  console.log(
    `PASS ${checks} administrator/connector checks; all migrations applied to empty isolated database.`,
  );
} finally {
  await app.end();
  await migrator.end();
  bootstrap('postgres', `DROP DATABASE ${name} WITH (FORCE)`);
}
