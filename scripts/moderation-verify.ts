import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplicationPool, createPool } from '../packages/database/dist/index.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AppModule } from '../apps/api/dist/app.module.js';
import { createApiClient } from '../packages/api-client/dist/index.js';

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
      // Ignore
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
  private readonly baseUrl: string;
  readonly connections: ReturnType<typeof createApiClient>['connections'];
  readonly moderation: ReturnType<typeof createApiClient>['moderation'];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    const api = createApiClient({
      baseUrl,
      fetcher: async (url, init) => {
        const headers = new Headers(init?.headers);
        if (init?.credentials === 'include') headers.set('cookie', this.cookieHeader());
        return fetch(url, { ...init, headers });
      },
    });
    this.connections = api.connections;
    this.moderation = api.moderation;
  }

  get options() {
    return { auth: { kind: 'web' as const, ...(this.csrf ? { csrfToken: this.csrf } : {}) } };
  }

  get modOptions() {
    return { ...(this.csrf ? { csrfToken: this.csrf } : {}) };
  }

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
    options: { method?: string; body?: unknown; csrf?: boolean; idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers = new Headers();
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
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
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }
}

async function main(): Promise<void> {
  clearRateLimits();

  const appPool = createApplicationPool();
  const adminPool = createPool('aven_migrator');
  const workerPool = createPool('aven_worker');

  const nestApp = await createApiApplication(
    parseApiEnvironment(process.env),
    () => undefined,
    AppModule,
    {
      check: async () => ({
        ok: true,
        checks: { database: true, redis: true, migrations: true },
        retryable: false,
      }),
    },
  );
  await nestApp.listen(0);
  const server = nestApp.getHttpServer();
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const client1 = new Client(baseUrl);
  const client2 = new Client(baseUrl);
  const client3 = new Client(baseUrl);

  try {
    const registerAndLogin = async (client: Client, email: string): Promise<string> => {
      const registerRes = await client.call('/api/v1/auth/register', {
        method: 'POST',
        body: { email, password: 'Password123!', displayName: email.split('@')[0] },
        csrf: false,
      });
      if (registerRes.status !== 201) {
        throw new Error(`Registration failed for ${email}: ${JSON.stringify(registerRes.body)}`);
      }
      const userId = String(nested(registerRes.body, ['user', 'id']));
      const token = readVerificationToken(email);
      if (!token) throw new Error(`Missing token for ${email}`);
      await client.call('/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token },
        csrf: false,
      });
      const loginRes = await client.call('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: 'Password123!', client: 'web' },
        csrf: false,
      });
      if (loginRes.status !== 200) {
        throw new Error(`Login failed for ${email}: ${JSON.stringify(loginRes.body)}`);
      }
      const csrf = nested(loginRes.body, ['csrfToken']);
      if (typeof csrf === 'string') client.csrf = csrf;
      return userId;
    };

    const runId = randomUUID().slice(0, 8);
    const user1 = { userId: await registerAndLogin(client1, `user1-mod-${runId}@example.com`) };
    const user2 = { userId: await registerAndLogin(client2, `user2-mod-${runId}@example.com`) };
    const user3 = { userId: await registerAndLogin(client3, `user3-mod-${runId}@example.com`) };
    check(
      'three test accounts registered for moderation checks',
      !!user1.userId && !!user2.userId && !!user3.userId,
    );

    // 2. User 1 blocks User 2
    const block1 = await client1.moderation.blockUser(
      { blockedUserId: user2.userId, reason: 'Harassing invitations' },
      client1.modOptions,
    );
    check(
      'user 1 successfully blocks user 2',
      !!block1.id && block1.blockedUserId === user2.userId,
    );

    // 3. User 1 lists blocks -> User 2 is present
    const list1 = await client1.moderation.listBlocks(client1.modOptions);
    check(
      'user 1 sees user 2 in block list',
      list1.blocks.length === 1 && list1.blocks[0]?.blockedUserId === user2.userId,
    );

    // 4. User 2 cannot see User 1's block list (RLS isolation)
    const list2 = await client2.moderation.listBlocks(client2.modOptions);
    check('user 2 block list is empty (RLS isolation)', list2.blocks.length === 0);

    // 5. Cannot block self
    const selfBlock = await client1.call('/api/v1/blocks', {
      method: 'POST',
      body: { blockedUserId: user1.userId },
    });
    check('user cannot block self (rejected)', selfBlock.status === 422);

    // 6. User 2 creates memory and tries to send invitation to User 1 -> blocked!
    const mem2 = await client2.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'interest',
        title: 'User 2 Interest',
        content: 'User 2 public bio for connection',
        allowedUses: ['sharing'],
      },
    });
    check('user 2 creates memory item', mem2.status === 201);
    const mem2Id = String(record(mem2.body).id);

    const preview2 = await client2.connections.preview(
      { recipientUserId: user1.userId, memoryItemIds: [mem2Id] },
      client2.options,
    );
    check('user 2 creates connection preview', !!preview2.id);

    // User 2 attempts to send invitation to User 1
    const inviteAttempt2 = await client2.call('/api/v1/connections/invitations', {
      method: 'POST',
      body: { previewId: preview2.id },
      idempotencyKey: randomUUID(),
    });
    check('user 2 invitation to user 1 is blocked (403)', inviteAttempt2.status === 403);

    // 7. Bidirectional block check: User 1 also cannot send invitation to User 2
    const mem1 = await client1.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'interest',
        title: 'User 1 Interest',
        content: 'User 1 public bio for connection',
        allowedUses: ['sharing'],
      },
    });
    check('user 1 creates memory item', mem1.status === 201);
    const mem1Id = String(record(mem1.body).id);
    const preview1 = await client1.connections.preview(
      { recipientUserId: user2.userId, memoryItemIds: [mem1Id] },
      client1.options,
    );
    const inviteAttempt1 = await client1.call('/api/v1/connections/invitations', {
      method: 'POST',
      body: { previewId: preview1.id },
      idempotencyKey: randomUUID(),
    });
    check('user 1 invitation to user 2 is also blocked (403)', inviteAttempt1.status === 403);

    // 8. User 1 unblocks User 2
    const unblockRes = await client1.moderation.unblockUser(user2.userId, client1.modOptions);
    check('user 1 unblocks user 2', unblockRes.unblocked === true);

    const list1After = await client1.moderation.listBlocks(client1.modOptions);
    check('user 1 block list is now empty', list1After.blocks.length === 0);

    // 9. Invitation succeeds after unblock
    // Create fresh preview since previous preview consumed_at might not be set
    const preview1Fresh = await client1.connections.preview(
      { recipientUserId: user2.userId, memoryItemIds: [mem1Id] },
      client1.options,
    );
    const inviteSend = await client1.connections.send(
      preview1Fresh.id,
      randomUUID(),
      client1.options,
    );
    check('user 1 sends invitation to user 2 after unblock', !!inviteSend.id);

    // User 2 accepts invitation -> established connection
    const acceptRes = await client2.connections.decide(
      inviteSend.id,
      { decision: 'accepted', expectedVersion: inviteSend.version },
      client2.options,
    );
    check('user 2 accepts invitation', acceptRes.status === 'accepted');
    const connectionId = acceptRes.connectionId!;
    check('peer connection established', !!connectionId);

    // 10. Message sending and blocking interaction
    const msg1 = await client1.connections.sendMessage(
      connectionId,
      { content: 'Hello before block', clientMessageId: randomUUID() },
      client1.options,
    );
    check('user 1 sends message to connection', !!msg1.id);

    // User 2 blocks User 1!
    await client2.moderation.blockUser(
      { blockedUserId: user1.userId, reason: 'Temporary block' },
      client2.modOptions,
    );
    check('user 2 blocks user 1', true);

    // User 1 tries to send message -> blocked!
    const msgAttempt1 = await client1.call(`/api/v1/connections/${connectionId}/messages`, {
      method: 'POST',
      body: { content: 'Blocked message attempt 1', clientMessageId: randomUUID() },
    });
    check('user 1 cannot send message when blocked by user 2 (403)', msgAttempt1.status === 403);

    // User 2 also cannot send message to User 1
    const msgAttempt2 = await client2.call(`/api/v1/connections/${connectionId}/messages`, {
      method: 'POST',
      body: { content: 'Blocked message attempt 2', clientMessageId: randomUUID() },
    });
    check('user 2 cannot send message when user 1 is blocked (403)', msgAttempt2.status === 403);

    // User 2 unblocks User 1
    await client2.moderation.unblockUser(user1.userId, client2.modOptions);

    // User 1 sends message again -> succeeds
    const msg2 = await client1.connections.sendMessage(
      connectionId,
      { content: 'Hello after unblock', clientMessageId: randomUUID() },
      client1.options,
    );
    check('user 1 sends message after unblock', !!msg2.id);

    // 11. Content & User Reporting
    const report1 = await client1.moderation.submitReport(
      {
        targetType: 'user',
        targetId: user2.userId,
        reason: 'harassment',
        details: 'User sent inappropriate messages',
      },
      client1.modOptions,
    );
    check('user 1 submits user report', report1.status === 'open' && report1.targetType === 'user');

    const report2 = await client1.moderation.submitReport(
      {
        targetType: 'peer_message',
        targetId: msg1.id,
        reason: 'spam',
        details: 'Spam content',
      },
      client1.modOptions,
    );
    check(
      'user 1 submits message report',
      report2.status === 'open' && report2.targetType === 'peer_message',
    );

    // User 1 lists reports -> 2 reports
    const myReports1 = await client1.moderation.listReports(client1.modOptions);
    check('user 1 sees own reports in list', myReports1.reports.length === 2);

    // User 2 lists reports -> 0 reports (reporter isolation)
    const myReports2 = await client2.moderation.listReports(client2.modOptions);
    check('user 2 sees no reports (reporter isolation)', myReports2.reports.length === 0);

    // 12. Rate limiting check: verify invitation rate limit error code
    // We can directly test app.send_connection_invitation rate limit enforcement:
    // Insert 20 invitations for user3 in the database, then test 21st invitation via API
    await adminPool.query(`
      DO $$
      DECLARE
        i integer;
        v_inv_id uuid;
        v_grant_id uuid;
        v_prev_id uuid;
      BEGIN
        FOR i IN 1..20 LOOP
          v_inv_id := gen_random_uuid();
          v_grant_id := gen_random_uuid();
          v_prev_id := gen_random_uuid();

          INSERT INTO public.connection_previews(id, actor_user_id, recipient_user_id, memory_item_ids, manifest, expires_at, grant_expires_at)
          VALUES (v_prev_id, '${user3.userId}'::uuid, '${user1.userId}'::uuid, ARRAY['${mem1Id}'::uuid], '[]'::jsonb, clock_timestamp() + interval '1 day', clock_timestamp() + interval '1 day');

          INSERT INTO public.consent_grants(id, grantor_principal_id, grantee_principal_id, purpose, expires_at, connection_invitation_id)
          VALUES (v_grant_id, '${user3.userId}'::uuid, '${user1.userId}'::uuid, 'connection_invitation', clock_timestamp() + interval '1 day', v_inv_id);

          INSERT INTO public.connection_invitations(id, sender_user_id, recipient_user_id, preview_id, idempotency_key, grant_id, expires_at, status)
          VALUES (v_inv_id, '${user3.userId}'::uuid, '${user1.userId}'::uuid, v_prev_id, gen_random_uuid(), v_grant_id, clock_timestamp() + interval '1 day', 'withdrawn');
        END LOOP;
      END $$;
    `);

    // User 3 creates preview targeting User 2 and attempts to send invitation
    const mem3 = await client3.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'interest',
        title: 'User 3 Interest',
        content: 'User 3 bio for rate limit test',
        allowedUses: ['sharing'],
      },
    });
    const mem3Id = String(record(mem3.body).id);
    const preview3 = await client3.connections.preview(
      { recipientUserId: user2.userId, memoryItemIds: [mem3Id] },
      client3.options,
    );
    const rateLimitAttempt = await client3.call('/api/v1/connections/invitations', {
      method: 'POST',
      body: { previewId: preview3.id },
      idempotencyKey: randomUUID(),
    });
    check(
      'user 3 21st invitation is rejected by 24h rate limit (409)',
      rateLimitAttempt.status === 409,
    );

    // 13. Direct database security checks
    const appDirectBlock = await appPool
      .query(
        `INSERT INTO public.block_lists (owner_user_id, blocked_user_id) VALUES ('${user1.userId}', '${user3.userId}')`,
      )
      .then(() => false)
      .catch(() => true);
    check('app role cannot directly insert into block_lists', appDirectBlock);

    const appDirectReport = await appPool
      .query(
        `INSERT INTO public.reports (reporter_user_id, target_type, target_id, reason) VALUES ('${user1.userId}', 'user', '${user3.userId}', 'spam')`,
      )
      .then(() => false)
      .catch(() => true);
    check('app role cannot directly insert into reports', appDirectReport);
  } finally {
    await nestApp.close();
    await appPool.end();
    await adminPool.end();
    await workerPool.end();
  }

  if (failed > 0) {
    console.error(`\n${failed} checks failed.`);
    process.exit(1);
  }
  console.log('\nAll moderation, block, report, and rate limiting checks passed cleanly!\n');
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
