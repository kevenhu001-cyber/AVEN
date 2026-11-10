import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { migrationDatabaseUrl } from './env.js';

const migrationsDir = resolve(import.meta.dirname, '../migrations');
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
const targetIndex = args.indexOf('--to');
const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
if (targetIndex >= 0 && !target) throw new Error('--to requires a migration tag.');
if (target && !files.some((file) => file === `${target}.sql`)) {
  throw new Error(`Unknown migration target: ${target}`);
}

function checksum(file: string): string {
  return createHash('sha256')
    .update(readFileSync(resolve(migrationsDir, file)))
    .digest('hex');
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: migrationDatabaseUrl() });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('aven:migrations'))");
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS app;
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        execution_ms integer NOT NULL
      );
    `);
    const applied = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM app.schema_migrations',
    );
    const appliedByVersion = new Map(applied.rows.map((row) => [row.version, row.checksum]));

    if (statusOnly) {
      for (const file of files) {
        const version = file.slice(0, -4);
        const state = appliedByVersion.has(version) ? 'applied' : 'pending';
        console.log(`${state.padEnd(8)} ${version}`);
      }
      return;
    }

    let appliedCount = 0;
    for (const file of files) {
      const version = file.slice(0, -4);
      const fileChecksum = checksum(file);
      const previousChecksum = appliedByVersion.get(version);
      if (previousChecksum !== undefined) {
        if (previousChecksum !== fileChecksum) {
          throw new Error(
            `${version} changed after it was applied. Add a new migration instead of editing history.`,
          );
        }
        console.log(`skipped  ${version}`);
      } else {
        const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
        const started = Date.now();
        await client.query('BEGIN');
        try {
          await client.query("SET LOCAL lock_timeout = '5s'");
          await client.query("SET LOCAL statement_timeout = '120s'");
          await client.query(sql);
          const executionMs = Date.now() - started;
          await client.query(
            'INSERT INTO app.schema_migrations (version, checksum, execution_ms) VALUES ($1, $2, $3)',
            [version, fileChecksum, executionMs],
          );
          await client.query('COMMIT');
          appliedCount += 1;
          console.log(`applied  ${version} (${executionMs}ms)`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
      if (target && version === target) break;
    }
    console.log(
      appliedCount === 0 ? 'No pending migrations.' : `Applied ${appliedCount} migration(s).`,
    );
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('aven:migrations'))")
      .catch(() => undefined);
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
