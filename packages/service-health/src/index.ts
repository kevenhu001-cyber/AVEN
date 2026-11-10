import { Redis } from 'ioredis';
import { redisUrl } from '@aven/config/env';
import { createApplicationPool, requiredSchemaVersion, type DatabasePool } from '@aven/database';

export type ReadinessChecks = {
  database: boolean;
  redis: boolean;
  migrations: boolean;
  consumers?: boolean;
};

export type ReadinessResult = {
  ok: boolean;
  checks: ReadinessChecks;
  retryable: boolean;
};

export type ReadinessRuntime = {
  check(): Promise<ReadinessResult>;
  close(): Promise<void>;
};

const probeTimeoutMs = 2000;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), probeTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Readiness probes are intentionally separate from liveness. They open a
 * short-lived pool and Redis connection, and never expose connection details.
 */
export function createReadinessRuntime(
  options: { extraChecks?: Partial<ReadinessChecks> } = {},
): ReadinessRuntime {
  let pool: DatabasePool | undefined;
  let redis: Redis | undefined;

  function getPool(): DatabasePool {
    pool ??= createApplicationPool({
      max: 1,
      connectionTimeoutMillis: 1500,
      statementTimeout: 1500,
    });
    return pool;
  }

  function getRedis(): Redis {
    if (!redis) {
      redis = new Redis(redisUrl(), {
        lazyConnect: true,
        connectTimeout: 1500,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      redis.on('error', () => undefined);
    }
    return redis;
  }

  async function checkDatabase(): Promise<boolean> {
    try {
      const result = await withTimeout(
        getPool().query<{ ok: number }>('SELECT 1 AS ok'),
        'database',
      );
      return result.rows[0]?.ok === 1;
    } catch {
      await pool?.end().catch(() => undefined);
      pool = undefined;
      return false;
    }
  }

  async function checkMigrations(): Promise<boolean> {
    try {
      const result = await withTimeout(
        getPool().query('SELECT 1 FROM app.schema_migrations WHERE version = $1', [
          requiredSchemaVersion,
        ]),
        'migrations',
      );
      return (result.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  }

  async function checkRedis(): Promise<boolean> {
    try {
      const client = getRedis();
      if (client.status === 'wait') await client.connect();
      const pong = await withTimeout(client.ping(), 'redis');
      return pong === 'PONG';
    } catch {
      redis?.disconnect();
      redis = undefined;
      return false;
    }
  }

  return {
    async check() {
      const [database, redisOk] = await Promise.all([checkDatabase(), checkRedis()]);
      const migrations = database ? await checkMigrations() : false;
      const checks: ReadinessChecks = {
        database,
        redis: redisOk,
        migrations,
        ...options.extraChecks,
      };
      const ok = Object.values(checks).every((value) => value === true);
      return { ok, checks, retryable: !ok };
    },
    async close() {
      const currentPool = pool;
      const currentRedis = redis;
      pool = undefined;
      redis = undefined;
      await currentPool?.end().catch(() => undefined);
      currentRedis?.disconnect();
    },
  };
}

export function createWorkerReadinessRuntime(): ReadinessRuntime {
  // No queue consumer exists until M0-07; readiness must not claim otherwise.
  return createReadinessRuntime({ extraChecks: { consumers: false } });
}

let configuredRuntime: ReadinessRuntime | undefined;

export function configureReadiness(runtime: ReadinessRuntime): void {
  configuredRuntime = runtime;
}

export function getReadinessRuntime(): ReadinessRuntime {
  if (!configuredRuntime) throw new Error('Readiness runtime is not configured.');
  return configuredRuntime;
}
