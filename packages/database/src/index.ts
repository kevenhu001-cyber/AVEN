import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { applicationDatabaseUrl, databaseUrlFor } from './env.js';

export * from './schema.js';
export { databaseUrlFor, applicationDatabaseUrl, migrationDatabaseUrl } from './env.js';
export { seedIds, seedVersion } from './seed-data.js';

export type DatabasePoolRole = 'aven_migrator' | 'aven_app' | 'aven_worker' | 'aven_auth';
export type DatabasePool = Pool;

export const requiredSchemaVersion = '0008_profile_and_campus';

export function createPool(
  role: DatabasePoolRole = 'aven_app',
  options: {
    max?: number;
    connectionString?: string;
    connectionTimeoutMillis?: number;
    statementTimeout?: number;
  } = {},
): Pool {
  return new Pool({
    connectionString: options.connectionString ?? databaseUrlFor(role),
    max: options.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    statement_timeout: options.statementTimeout ?? 10_000,
    application_name: `aven-${role}`,
  });
}

export function createApplicationPool(
  options: {
    max?: number;
    connectionTimeoutMillis?: number;
    statementTimeout?: number;
  } = {},
): Pool {
  return createPool('aven_app', { ...options, connectionString: applicationDatabaseUrl() });
}

export type RequestContext = {
  principalId?: string;
  userId?: string;
  organizationId?: string;
  requestId?: string;
};

/**
 * Binds request identity inside a transaction. Values are passed as bind
 * parameters, never interpolated into SQL. Context is transaction-local so a
 * pooled connection cannot leak one request's identity into the next.
 */
export async function withRequestContext<T>(
  pool: Pool,
  context: RequestContext,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.principal_id', $1, true)", [
      context.principalId ?? '',
    ]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [context.userId ?? '']);
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      context.organizationId ?? '',
    ]);
    await client.query("SELECT set_config('app.request_id', $1, true)", [context.requestId ?? '']);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
