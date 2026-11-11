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
    options: {
      method?: string;
      body?: unknown;
      csrf?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers = new Headers(options.headers);
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
  const apiLogs: unknown[] = [];
  const app = await createApiApplication(env, (entry) => apiLogs.push(entry), AppModule, {
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
  const appPool = createApplicationPool({ max: 2 });
  const userIds: string[] = [];
  const actionIds: string[] = [];
  const runIds: string[] = [];
  const conversationIds: string[] = [];
  const stamp = Date.now();
  const password = 'Correct Horse Battery Staple 42!';
  const emailA = `action.a.${stamp}@example.test`;
  const emailB = `action.b.${stamp}@example.test`;
  const clientA = new Client(baseUrl);
  const clientB = new Client(baseUrl);

  async function createAction(
    title: string,
    content: string,
  ): Promise<{ id: string; token: string }> {
    const response = await clientA.call('/api/v1/actions', {
      method: 'POST',
      body: {
        actionType: 'memory.create',
        payload: { kind: 'skill', title, content, allowedUses: ['self_ai'] },
        expiresInSeconds: 600,
      },
    });
    const id = String(nested(response.body, ['id']));
    const token = String(nested(response.body, ['confirmationToken']));
    if (id) actionIds.push(id);
    return { id, token };
  }

  try {
    const userA = await clientA.register(emailA, 'Action 用户 A', password);
    const userB = await clientB.register(emailB, 'Action 用户 B', password);
    userIds.push(userA, userB);
    check('action users register and log in', Boolean(userA && userB));

    const run = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'action-run-1' },
      body: { input: '行动绑定测试' },
    });
    const runId = String(nested(run.body, ['runId']));
    const conversationId = String(nested(run.body, ['conversationId']));
    runIds.push(runId);
    conversationIds.push(conversationId);
    check('action test run is created', run.status === 201 && Boolean(runId));

    const created = await clientA.call('/api/v1/actions', {
      method: 'POST',
      body: {
        actionType: 'memory.create',
        payload: {
          kind: 'skill',
          title: '行动技能',
          content: '行动正文',
          allowedUses: ['self_ai'],
        },
        runId,
        expiresInSeconds: 600,
      },
    });
    const actionId = String(nested(created.body, ['id']));
    const token = String(nested(created.body, ['confirmationToken']));
    if (actionId) actionIds.push(actionId);
    check(
      'action draft creation returns 201',
      created.status === 201,
      JSON.stringify(created.body),
    );
    check(
      'action draft is pending confirmation with a preview',
      nested(created.body, ['status']) === 'pending_confirmation' &&
        nested(created.body, ['draftVersion']) === 1 &&
        nested(created.body, ['preview', 'title']) === '行动技能',
    );
    check(
      'action draft binds the agent run',
      nested(created.body, ['runId']) === runId &&
        nested(created.body, ['organizationId']) === null,
    );
    check(
      'action draft returns a one-time token and future expiry',
      token.length >= 32 && typeof nested(created.body, ['expiresAt']) === 'string',
    );

    const fetched = await clientA.call(`/api/v1/actions/${actionId}`);
    check(
      'action preview is readable by the owner',
      fetched.status === 200 && nested(fetched.body, ['preview', 'title']) === '行动技能',
    );
    check(
      'action preview does not expose the confirmation token',
      nested(fetched.body, ['confirmationToken']) === undefined,
    );

    const otherGet = await clientB.call(`/api/v1/actions/${actionId}`);
    check('another user cannot read the action', otherGet.status === 404);
    const otherConfirm = await clientB.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-other-confirm' },
      body: { expectedDraftVersion: 1, confirmationToken: token },
    });
    check('another user cannot confirm the action', otherConfirm.status === 404);
    const otherCancel = await clientB.call(`/api/v1/actions/${actionId}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-other-cancel' },
    });
    check('another user cannot cancel the action', otherCancel.status === 404);

    const missingKey = await clientA.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      body: { expectedDraftVersion: 1, confirmationToken: token },
    });
    check('action confirmation requires an idempotency key', missingKey.status === 422);
    const wrongVersion = await clientA.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-confirm-wrong-version' },
      body: { expectedDraftVersion: 99, confirmationToken: token },
    });
    check(
      'action confirmation rejects a stale draft version',
      wrongVersion.status === 409 &&
        nested(wrongVersion.body, ['error', 'code']) === 'VERSION_CONFLICT',
    );
    const wrongToken = await clientA.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-confirm-wrong-token' },
      body: { expectedDraftVersion: 1, confirmationToken: 'wrong-token' },
    });
    check(
      'action confirmation rejects an invalid token',
      wrongToken.status === 403 &&
        nested(wrongToken.body, ['error', 'code']) === 'ACTION_TOKEN_INVALID',
    );

    const confirmed = await clientA.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-confirm-1' },
      body: { expectedDraftVersion: 1, confirmationToken: token },
    });
    const memoryId = String(nested(confirmed.body, ['result', 'memoryId']));
    check(
      'action confirmation succeeds',
      confirmed.status === 200 &&
        nested(confirmed.body, ['status']) === 'succeeded' &&
        Boolean(memoryId),
      JSON.stringify(confirmed.body),
    );
    check(
      'action confirmation records timestamps',
      typeof nested(confirmed.body, ['confirmedAt']) === 'string' &&
        typeof nested(confirmed.body, ['executedAt']) === 'string',
    );
    const memory = await clientA.call(`/api/v1/memories/${memoryId}`);
    check(
      'confirmed action creates the memory',
      memory.status === 200 &&
        nested(memory.body, ['title']) === '行动技能' &&
        nested(memory.body, ['content']) === '行动正文',
    );

    const countMemories = async (): Promise<string> => {
      const result = await withRequestContext(
        appPool,
        { principalId: userA, userId: userA },
        async (client) =>
          client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM public.memory_items WHERE owner_principal_id = $1 AND title = '行动技能'",
            [userA],
          ),
      );
      return result.rows[0]?.count ?? '';
    };
    check('action execution creates exactly one memory', (await countMemories()) === '1');
    const duplicateSame = await clientA.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-confirm-1' },
      body: { expectedDraftVersion: 1, confirmationToken: token },
    });
    check(
      'duplicate confirmation returns the same result',
      duplicateSame.status === 200 &&
        nested(duplicateSame.body, ['result', 'memoryId']) === memoryId,
    );
    const duplicateNew = await clientA.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-confirm-2' },
      body: { expectedDraftVersion: 1, confirmationToken: token },
    });
    check(
      'a new idempotency key does not re-execute',
      duplicateNew.status === 200 && nested(duplicateNew.body, ['result', 'memoryId']) === memoryId,
    );
    check('duplicate confirmations do not duplicate the memory', (await countMemories()) === '1');

    const tokenRow = await migrator.query<{ hash: string }>(
      'SELECT confirmation_token_hash AS hash FROM public.actions WHERE id = $1',
      [actionId],
    );
    check(
      'action stores only the token hash',
      tokenRow.rows[0]?.hash.length === 64 && tokenRow.rows[0]?.hash !== token,
    );

    const cancelTarget = await createAction('取消技能', '取消正文');
    const cancelled = await clientA.call(`/api/v1/actions/${cancelTarget.id}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-cancel-1' },
    });
    check(
      'pending action can be cancelled',
      cancelled.status === 200 && nested(cancelled.body, ['status']) === 'cancelled',
    );
    const cancelledAgain = await clientA.call(`/api/v1/actions/${cancelTarget.id}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-cancel-1' },
    });
    check(
      'action cancellation is idempotent',
      cancelledAgain.status === 200 && nested(cancelledAgain.body, ['status']) === 'cancelled',
    );
    const confirmCancelled = await clientA.call(`/api/v1/actions/${cancelTarget.id}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-confirm-cancelled' },
      body: { expectedDraftVersion: 1, confirmationToken: cancelTarget.token },
    });
    check(
      'cancelled action cannot be confirmed',
      confirmCancelled.status === 409 &&
        nested(confirmCancelled.body, ['error', 'code']) === 'ACTION_NOT_CONFIRMABLE',
    );
    const cancelExecuted = await clientA.call(`/api/v1/actions/${actionId}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-cancel-executed' },
    });
    check(
      'executed action cannot be cancelled',
      cancelExecuted.status === 409 &&
        nested(cancelExecuted.body, ['error', 'code']) === 'ACTION_NOT_CONFIRMABLE',
    );

    const expiredTarget = await createAction('过期技能', '过期正文');
    await migrator.query(
      "UPDATE public.actions SET expires_at = now() - interval '1 second' WHERE id = $1",
      [expiredTarget.id],
    );
    const confirmExpired = await clientA.call(`/api/v1/actions/${expiredTarget.id}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': 'action-confirm-expired' },
      body: { expectedDraftVersion: 1, confirmationToken: expiredTarget.token },
    });
    check(
      'expired action cannot be confirmed',
      confirmExpired.status === 409 &&
        nested(confirmExpired.body, ['error', 'code']) === 'ACTION_EXPIRED',
    );
    const expiredGet = await clientA.call(`/api/v1/actions/${expiredTarget.id}`);
    check(
      'expired action status is persisted',
      expiredGet.status === 200 && nested(expiredGet.body, ['status']) === 'expired',
    );

    const otherRunAction = await clientB.call('/api/v1/actions', {
      method: 'POST',
      body: {
        actionType: 'memory.create',
        payload: { kind: 'skill', title: '越权技能', content: '越权正文' },
        runId,
      },
    });
    check('another user cannot bind an action to the run', otherRunAction.status === 404);

    const invalidPayload = await clientA.call('/api/v1/actions', {
      method: 'POST',
      body: {
        actionType: 'memory.create',
        payload: { kind: 'skill', title: '', content: 'x' },
      },
    });
    check('invalid action payload is rejected', invalidPayload.status === 422);
    const invalidExpiry = await clientA.call('/api/v1/actions', {
      method: 'POST',
      body: {
        actionType: 'memory.create',
        payload: { kind: 'skill', title: '有效期', content: '有效期' },
        expiresInSeconds: 0,
      },
    });
    check('invalid action expiry is rejected', invalidExpiry.status === 422);
    const missingCsrf = await clientA.call(`/api/v1/actions/${expiredTarget.id}/confirm`, {
      method: 'POST',
      csrf: false,
      headers: { 'idempotency-key': 'action-confirm-csrf' },
      body: { expectedDraftVersion: 1, confirmationToken: expiredTarget.token },
    });
    check('action confirmation without CSRF is rejected', missingCsrf.status === 403);

    check(
      'action preview is not written to logs',
      !JSON.stringify(apiLogs).includes('行动技能') &&
        !JSON.stringify(apiLogs).includes('行动正文'),
    );
  } finally {
    if (actionIds.length) {
      await migrator
        .query('DELETE FROM public.actions WHERE id = ANY($1::uuid[])', [actionIds])
        .catch(() => undefined);
    }
    if (userIds.length) {
      await migrator
        .query('DELETE FROM public.idempotency_keys WHERE principal_id = ANY($1::uuid[])', [
          userIds,
        ])
        .catch(() => undefined);
    }
    if (runIds.length) {
      await migrator
        .query(
          "DELETE FROM public.outbox_events WHERE aggregate_type = 'agent_run' AND aggregate_id = ANY($1::uuid[])",
          [runIds],
        )
        .catch(() => undefined);
      await migrator
        .query('DELETE FROM public.agent_runs WHERE id = ANY($1::uuid[])', [runIds])
        .catch(() => undefined);
    }
    if (conversationIds.length) {
      await migrator
        .query('DELETE FROM public.conversations WHERE id = ANY($1::uuid[])', [conversationIds])
        .catch(() => undefined);
    }
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
    console.error(`\n${failed} action check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll action confirmation checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Action verification failed.');
  process.exitCode = 1;
});
