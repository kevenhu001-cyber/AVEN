import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  createApplicationPool,
  createPool,
  withRequestContext,
} from '../packages/database/dist/index.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AppModule } from '../apps/api/dist/app.module.js';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
const composeFile = resolve(root, 'infra/compose/compose.yaml');
if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed += 1;
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function nested(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) current = record(current)[key];
  return current;
}
function readVerificationToken(email: string): string | undefined {
  const directory = resolve(root, process.env.AUTH_MAIL_DIR ?? '.data/mail');
  if (!existsSync(directory)) return undefined;
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse();
  for (const file of files) {
    try {
      const message = JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as {
        to?: string;
        kind?: string;
        text?: string;
      };
      if (message.to !== email || message.kind !== 'verify_email') continue;
      const match = /验证令牌：(\S+)/.exec(message.text ?? '');
      if (match?.[1]) return match[1];
    } catch {
      // Ignore malformed dev mail files.
    }
  }
  return undefined;
}
function clearRateLimits(): void {
  spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      envFile,
      '-f',
      composeFile,
      'exec',
      '-T',
      'redis',
      'sh',
      '-c',
      'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --scan --pattern "auth:rl:*" | while read key; do REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli del "$key"; done',
    ],
    { cwd: root, stdio: 'ignore' },
  );
}

class Client {
  private jar = new Map<string, string>();
  csrf: string | undefined;

  constructor(private readonly baseUrl: string) {}

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private updateCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index);
      const value = decodeURIComponent(pair.slice(index + 1));
      if (/Max-Age=0/i.test(raw)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async call(
    path: string,
    options: { method?: string; body?: unknown; csrf?: boolean } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers = new Headers();
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.csrf !== false && this.csrf) headers.set('x-csrf-token', this.csrf);
    if (this.jar.size) headers.set('cookie', this.cookieHeader());
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
    });
    this.updateCookies(response);
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  }

  async register(email: string, displayName: string, password: string): Promise<string> {
    const register = await this.call('/api/v1/auth/register', {
      method: 'POST',
      csrf: false,
      body: { email, password, displayName },
    });
    const userId = nested(register.body, ['user', 'id']);
    const token = readVerificationToken(email);
    await this.call('/api/v1/auth/verify-email', {
      method: 'POST',
      csrf: false,
      body: { token },
    });
    const login = await this.call('/api/v1/auth/login', {
      method: 'POST',
      csrf: false,
      body: { email, password, client: 'web' },
    });
    const csrf = nested(login.body, ['csrfToken']);
    if (typeof csrf === 'string') this.csrf = csrf;
    return typeof userId === 'string' ? userId : '';
  }
}

async function main(): Promise<void> {
  clearRateLimits();
  const env = parseApiEnvironment(process.env);
  const app = await createApiApplication(env, () => undefined, AppModule, {
    check: async () => ({
      ok: true,
      checks: { database: true, redis: true, migrations: true },
      retryable: false,
    }),
    close: async () => undefined,
  });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const migrator = createPool('aven_migrator', { max: 2 });
  const appPool = createApplicationPool({ max: 1 });
  const userIds: string[] = [];
  const stamp = Date.now();
  const password = 'Correct Horse Battery Staple 42!';
  const emailA = `memory.a.${stamp}@example.test`;
  const emailB = `memory.b.${stamp}@example.test`;
  const clientA = new Client(baseUrl);
  const clientB = new Client(baseUrl);

  try {
    const userA = await clientA.register(emailA, '记忆用户 A', password);
    const userB = await clientB.register(emailB, '记忆用户 B', password);
    userIds.push(userA, userB);
    check('memory users register and log in', Boolean(userA && userB));

    const campuses = await clientA.call('/api/v1/campuses');
    const campusId = Array.isArray(nested(campuses.body, ['data']))
      ? nested((nested(campuses.body, ['data']) as unknown[])[0], ['id'])
      : undefined;
    const validUntil = new Date(Date.now() + 86_400_000).toISOString();

    const created = await clientA.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'skill',
        title: '机器人控制',
        content: '四足机器人步态控制与 ROS 2 仿真',
        structuredValue: { level: 'advanced' },
        sensitivity: 'normal',
        displayAudience: 'owner',
        discoverable: false,
        allowedUses: ['self_ai', 'matching'],
        validUntil,
      },
    });
    check('memory creation returns 201', created.status === 201, JSON.stringify(created.body));
    const memoryId = nested(created.body, ['id']);
    check('memory is confirmed at version one', nested(created.body, ['status']) === 'confirmed');
    check(
      'memory policy returns allowed uses',
      Array.isArray(nested(created.body, ['policy', 'allowedUses'])),
    );
    check('memory has one manual source', nested(created.body, ['sourceCount']) === 1);

    const detail = await clientA.call(`/api/v1/memories/${String(memoryId)}`);
    check('memory detail returns 200', detail.status === 200);
    check(
      'memory detail includes the manual source',
      Array.isArray(nested(detail.body, ['sources'])) &&
        (nested(detail.body, ['sources']) as unknown[]).length === 1,
    );

    const list = await clientA.call('/api/v1/memories');
    check(
      'memory list includes the item',
      Array.isArray(nested(list.body, ['data'])) &&
        (nested(list.body, ['data']) as unknown[]).length === 1,
    );

    const updated = await clientA.call(`/api/v1/memories/${String(memoryId)}`, {
      method: 'PATCH',
      body: {
        expectedVersion: 1,
        title: '机器人控制（更新）',
        content: '更新后的项目经历',
        displayAudience: 'campus',
        campusId,
        discoverable: true,
        allowedUses: ['self_ai'],
      },
    });
    check('memory update returns 200', updated.status === 200, JSON.stringify(updated.body));
    check('memory update increments version', nested(updated.body, ['version']) === 2);
    check(
      'memory update applies campus policy',
      nested(updated.body, ['policy', 'displayAudience']) === 'campus' &&
        nested(updated.body, ['policy', 'discoverable']) === true,
    );

    const staleUpdate = await clientA.call(`/api/v1/memories/${String(memoryId)}`, {
      method: 'PATCH',
      body: { expectedVersion: 1, title: 'stale' },
    });
    check('stale memory update returns 409', staleUpdate.status === 409);

    const second = await clientA.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'interest',
        title: '具身智能',
        content: '关注具身智能与机器人学习',
        allowedUses: ['self_ai'],
      },
    });
    check('second memory creation returns 201', second.status === 201);

    const firstPage = await clientA.call('/api/v1/memories?limit=1');
    const nextCursor = nested(firstPage.body, ['nextCursor']);
    check(
      'memory list paginates with a cursor',
      Array.isArray(nested(firstPage.body, ['data'])) &&
        (nested(firstPage.body, ['data']) as unknown[]).length === 1 &&
        typeof nextCursor === 'string',
    );
    const secondPage = await clientA.call(
      `/api/v1/memories?limit=1&cursor=${encodeURIComponent(String(nextCursor))}`,
    );
    check(
      'memory cursor returns the next item',
      secondPage.status === 200 &&
        Array.isArray(nested(secondPage.body, ['data'])) &&
        (nested(secondPage.body, ['data']) as unknown[]).length === 1,
    );

    const otherUserRead = await clientB.call(`/api/v1/memories/${String(memoryId)}`);
    check('another user cannot read the memory', otherUserRead.status === 404);
    const otherUserUpdate = await clientB.call(`/api/v1/memories/${String(memoryId)}`, {
      method: 'PATCH',
      body: { expectedVersion: 2, title: 'hijack' },
    });
    check('another user cannot update the memory', otherUserUpdate.status === 404);
    const otherUserDelete = await clientB.call(
      `/api/v1/memories/${String(memoryId)}?expectedVersion=2`,
      { method: 'DELETE' },
    );
    check('another user cannot delete the memory', otherUserDelete.status === 404);

    const deleteMemory = await clientA.call(
      `/api/v1/memories/${String(memoryId)}?expectedVersion=2`,
      { method: 'DELETE' },
    );
    check('owner deletes the memory', deleteMemory.status === 204);
    const deletedRead = await clientA.call(`/api/v1/memories/${String(memoryId)}`);
    check('deleted memory is no longer readable', deletedRead.status === 404);

    const missingCsrf = await clientA.call('/api/v1/memories', {
      method: 'POST',
      csrf: false,
      body: { kind: 'skill', title: 'no csrf', content: 'no csrf' },
    });
    check('memory creation without CSRF returns 403', missingCsrf.status === 403);

    const invalidCampus = await clientA.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'skill',
        title: 'campus without id',
        content: 'campus without id',
        displayAudience: 'campus',
      },
    });
    check('campus audience without campus returns 422', invalidCampus.status === 422);

    const invalidDiscoverable = await clientA.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'skill',
        title: 'owner discoverable',
        content: 'owner discoverable',
        discoverable: true,
      },
    });
    check('owner-only discoverable memory returns 422', invalidDiscoverable.status === 422);

    const duplicateUses = await clientA.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'skill',
        title: 'duplicate uses',
        content: 'duplicate uses',
        allowedUses: ['self_ai', 'self_ai'],
      },
    });
    check('duplicate allowed uses return 422', duplicateUses.status === 422);

    const invalidCursor = await clientA.call('/api/v1/memories?cursor=not-a-cursor');
    check('invalid memory cursor returns 422', invalidCursor.status === 422);

    const aMemoryCount = await withRequestContext(
      appPool,
      { principalId: userA, userId: userA },
      async (client) =>
        client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM public.memory_items WHERE status <> 'deleted'",
        ),
    );
    const bMemoryCount = await withRequestContext(
      appPool,
      { principalId: userB, userId: userB },
      async (client) =>
        client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM public.memory_items WHERE status <> 'deleted'",
        ),
    );
    check('owner sees own memory rows', aMemoryCount.rows[0]?.count === '1');
    check('other user sees no memory rows', bMemoryCount.rows[0]?.count === '0');
  } finally {
    if (userIds.length) {
      await migrator
        .query(
          'DELETE FROM public.context_field_policies WHERE owner_principal_id = ANY($1::uuid[])',
          [userIds],
        )
        .catch(() => undefined);
      await migrator
        .query('DELETE FROM public.memory_items WHERE owner_principal_id = ANY($1::uuid[])', [
          userIds,
        ])
        .catch(() => undefined);
      await migrator
        .query('DELETE FROM public.principals WHERE id = ANY($1::uuid[])', [userIds])
        .catch(() => undefined);
    }
    await appPool.end().catch(() => undefined);
    await migrator.end().catch(() => undefined);
    await app.close();
  }

  if (failed) {
    console.error(`\n${failed} memory check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll memory checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Memory check failed.');
  process.exitCode = 1;
});
