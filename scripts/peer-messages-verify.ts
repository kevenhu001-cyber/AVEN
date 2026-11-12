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
  }

  get options() {
    return { auth: { kind: 'web' as const, ...(this.csrf ? { csrfToken: this.csrf } : {}) } };
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

async function registerAndLogin(client: Client, email: string): Promise<string> {
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
}

async function main(): Promise<void> {
  clearRateLimits();
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

  const workerPool = createPool('aven_worker');
  const adminPool = createPool('aven_migrator');
  const appPool = createApplicationPool();
  const client1 = new Client(baseUrl);
  const client2 = new Client(baseUrl);
  const client3 = new Client(baseUrl);

  try {
    const runId = randomUUID().slice(0, 8);
    const user1Id = await registerAndLogin(client1, `user1-msg-${runId}@example.com`);
    const user2Id = await registerAndLogin(client2, `user2-msg-${runId}@example.com`);
    const user3Id = await registerAndLogin(client3, `user3-msg-${runId}@example.com`);

    check('three test accounts registered for messaging', !!user1Id && !!user2Id && !!user3Id);

    // 1. User 1 creates memory item
    const memRes = await client1.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'interest',
        title: '开发样例兴趣',
        content: '允许分享的机器人兴趣',
        allowedUses: ['sharing'],
      },
    });
    check('user 1 creates memory item', memRes.status === 201);
    const memoryId = String(record(memRes.body).id);

    // 2. User 1 previews connection invitation to User 2
    const preview = await client1.connections.preview(
      { recipientUserId: user2Id, memoryItemIds: [memoryId] },
      client1.options,
    );
    check('user 1 creates connection preview', !!preview.id);

    // 3. User 1 sends invitation
    const invitationKey = randomUUID();
    const invitation = await client1.connections.send(preview.id, invitationKey, client1.options);
    check('user 1 sends connection invitation', !!invitation.id);

    // 4. User 2 accepts invitation -> establishes connection
    const decision = await client2.connections.decide(
      invitation.id,
      { decision: 'accepted', expectedVersion: invitation.version },
      client2.options,
    );
    check('user 2 accepts invitation', decision.status === 'accepted' && !!decision.connectionId);
    const connectionId = decision.connectionId!;

    // 5. User 1 sends message to User 2
    const clientMsgId1 = randomUUID();
    const msg1 = await client1.connections.sendMessage(
      connectionId,
      { content: 'Hello User 2! This is our first message.', clientMessageId: clientMsgId1 },
      client1.options,
    );
    check('user 1 sends peer message successfully', !!msg1.id);
    check(
      'message returns correct fields',
      msg1.connectionId === connectionId &&
        msg1.senderUserId === user1Id &&
        msg1.content === 'Hello User 2! This is our first message.' &&
        msg1.clientMessageId === clientMsgId1 &&
        !!msg1.createdAt,
    );

    // 6. Idempotency verification: same clientMessageId & same content
    const msg1Retry = await client1.connections.sendMessage(
      connectionId,
      { content: 'Hello User 2! This is our first message.', clientMessageId: clientMsgId1 },
      client1.options,
    );
    check('idempotent send returns identical message', msg1Retry.id === msg1.id);

    // 7. Idempotency conflict: same clientMessageId & different content -> 409
    const conflictRes = await client1.call(`/api/v1/connections/${connectionId}/messages`, {
      method: 'POST',
      body: { content: 'Different content attempt', clientMessageId: clientMsgId1 },
    });
    check(
      'same clientMessageId with different content returns 409 conflict',
      conflictRes.status === 409,
    );

    // 8. Content validations
    const emptyRes = await client1.call(`/api/v1/connections/${connectionId}/messages`, {
      method: 'POST',
      body: { content: '   ', clientMessageId: randomUUID() },
    });
    check('empty or whitespace-only content is rejected', emptyRes.status === 422);

    const longRes = await client1.call(`/api/v1/connections/${connectionId}/messages`, {
      method: 'POST',
      body: { content: 'a'.repeat(4001), clientMessageId: randomUUID() },
    });
    check('content exceeding 4000 characters is rejected', longRes.status === 422);

    // 9. User 2 lists messages
    const list2 = await client2.connections.listMessages(connectionId, {}, client2.options);
    check(
      'user 2 sees sent message in connection',
      list2.messages.length === 1 && list2.messages[0]?.id === msg1.id,
    );

    // 10. User 2 sends reply
    const clientMsgId2 = randomUUID();
    const msg2 = await client2.connections.sendMessage(
      connectionId,
      {
        content: 'Hi User 1, received your message loud and clear!',
        clientMessageId: clientMsgId2,
      },
      client2.options,
    );
    check('user 2 sends reply message', !!msg2.id);

    // 11. User 1 lists messages (verifying reverse-chronological order)
    const list1 = await client1.connections.listMessages(connectionId, {}, client1.options);
    check(
      'user 1 sees messages ordered by createdAt DESC',
      list1.messages.length === 2 &&
        list1.messages[0]?.id === msg2.id &&
        list1.messages[1]?.id === msg1.id,
    );

    // 12. Pagination verification
    // Send 3 more messages
    const msg3 = await client1.connections.sendMessage(
      connectionId,
      { content: 'Message 3', clientMessageId: randomUUID() },
      client1.options,
    );
    const msg4 = await client2.connections.sendMessage(
      connectionId,
      { content: 'Message 4', clientMessageId: randomUUID() },
      client2.options,
    );
    const msg5 = await client1.connections.sendMessage(
      connectionId,
      { content: 'Message 5', clientMessageId: randomUUID() },
      client1.options,
    );

    // Page 1: limit 2
    const page1 = await client1.connections.listMessages(
      connectionId,
      { limit: 2 },
      client1.options,
    );
    check(
      'pagination page 1 returns 2 messages',
      page1.messages.length === 2 &&
        page1.messages[0]?.id === msg5.id &&
        page1.messages[1]?.id === msg4.id,
    );
    check(
      'pagination page 1 returns nextCursor',
      !!page1.nextCursor?.createdAt && !!page1.nextCursor?.id,
    );

    // Page 2: with nextCursor
    const page2 = await client1.connections.listMessages(
      connectionId,
      {
        limit: 2,
        cursorCreatedAt: page1.nextCursor!.createdAt,
        cursorId: page1.nextCursor!.id,
      },
      client1.options,
    );
    check(
      'pagination page 2 returns next 2 messages',
      page2.messages.length === 2 && page2.messages[0]?.id === msg3.id,
    );
    check('pagination page 2 returns nextCursor', !!page2.nextCursor);

    // Page 3: with nextCursor
    const page3 = await client1.connections.listMessages(
      connectionId,
      {
        limit: 2,
        cursorCreatedAt: page2.nextCursor!.createdAt,
        cursorId: page2.nextCursor!.id,
      },
      client1.options,
    );
    check(
      'pagination page 3 returns final 1 message',
      page3.messages.length === 1 && page3.messages[0]?.id === msg1.id,
    );
    check('pagination page 3 returns null nextCursor', page3.nextCursor === null);

    // 13. Outsider User 3 isolation
    const outsiderList = await client3.call(`/api/v1/connections/${connectionId}/messages`);
    check('outsider user 3 cannot list messages', outsiderList.status === 404);

    const outsiderSend = await client3.call(`/api/v1/connections/${connectionId}/messages`, {
      method: 'POST',
      body: { content: 'Intruder message', clientMessageId: randomUUID() },
    });
    check('outsider user 3 cannot send message to connection', outsiderSend.status === 404);

    // 14. Soft-delete isolation: User 1 deletes message 5
    const delRes1 = await client1.connections.deleteMessage(connectionId, msg5.id, client1.options);
    check('user 1 soft-deletes message 5', delRes1.success && delRes1.messageId === msg5.id);

    const list1AfterDel = await client1.connections.listMessages(
      connectionId,
      { limit: 10 },
      client1.options,
    );
    check(
      'message 5 is hidden from user 1 after deletion',
      !list1AfterDel.messages.some((m) => m.id === msg5.id),
    );

    const list2AfterDel = await client2.connections.listMessages(
      connectionId,
      { limit: 10 },
      client2.options,
    );
    check(
      'message 5 is still visible to user 2 (soft delete isolation)',
      list2AfterDel.messages.some((m) => m.id === msg5.id),
    );

    // 15. User 2 also deletes message 5 -> double soft delete
    const delRes2 = await client2.connections.deleteMessage(connectionId, msg5.id, client2.options);
    check('user 2 soft-deletes message 5', delRes2.success);

    const list2AfterBothDel = await client2.connections.listMessages(
      connectionId,
      { limit: 10 },
      client2.options,
    );
    check(
      'message 5 is now hidden from user 2 as well',
      !list2AfterBothDel.messages.some((m) => m.id === msg5.id),
    );

    // 16. Worker maintenance hard purge
    // Check message 5 state before purge
    const prePurge = await adminPool.query<{ content: string; purged_at: string | null }>(
      'SELECT content, purged_at FROM public.peer_messages WHERE id = $1',
      [msg5.id],
    );
    check(
      'message 5 content exists before worker maintenance',
      prePurge.rows[0]?.content === 'Message 5',
    );

    // Run maintain_peer_messages via worker
    const maintenanceRes = await workerPool.query<{ result: { purged: number } }>(
      'SELECT app.maintain_peer_messages(100) AS result',
    );
    check(
      'worker runs maintain_peer_messages successfully',
      (maintenanceRes.rows[0]?.result?.purged ?? 0) >= 1,
    );

    // Check message 5 state after purge
    const postPurge = await adminPool.query<{ content: string; purged_at: string | null }>(
      'SELECT content, purged_at FROM public.peer_messages WHERE id = $1',
      [msg5.id],
    );
    check(
      'message 5 content is purged to empty string and purged_at is recorded',
      postPurge.rows[0]?.content === '' && postPurge.rows[0]?.purged_at !== null,
    );

    // App role cannot execute maintenance
    let appMaintenanceFailed = false;
    try {
      await appPool.query('SELECT app.maintain_peer_messages(100)');
    } catch {
      appMaintenanceFailed = true;
    }
    check('app role cannot execute worker maintain_peer_messages', appMaintenanceFailed);

    if (failed === 0) {
      console.log('\nAll peer messaging checks passed cleanly!\n');
    } else {
      console.error(`\nPeer messaging verification failed with ${failed} failure(s).\n`);
      process.exitCode = 1;
    }
  } finally {
    await nestApp.close();
    await workerPool.end();
    await adminPool.end();
    await appPool.end();
  }
}

main().catch((error) => {
  console.error('Unhandled error in peer messaging verification:', error);
  process.exit(1);
});
