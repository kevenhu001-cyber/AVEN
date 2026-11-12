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
import { createNotificationRuntime } from '../apps/worker/dist/notification.js';

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
  readonly notifications: ReturnType<typeof createApiClient>['notifications'];

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
    this.notifications = api.notifications;
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
    if (!token) throw new Error(`Missing token for ${email}`);
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

async function main() {
  clearRateLimits();
  const app = await createApiApplication(
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
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  const origin = `http://127.0.0.1:${port}`;

  const [u1, u2, u3] = [new Client(origin), new Client(origin), new Client(origin)];
  const pool = createPool('aven_worker');
  const admin = createPool('aven_migrator');
  const appPool = createApplicationPool();
  const runtime = createNotificationRuntime(pool, () => undefined);

  async function waitFor(test: () => Promise<boolean>, label: string) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Verification timeout: ${label}`);
  }

  try {
    await runtime.start();
    const run = randomUUID().slice(0, 8);
    const id1 = await u1.register(`ev1.${run}@example.test`, '活动用户1', 'StrongPassword!123');
    const id2 = await u2.register(`ev2.${run}@example.test`, '活动用户2', 'StrongPassword!123');
    const id3 = await u3.register(`ev3.${run}@example.test`, '活动用户3', 'StrongPassword!123');

    check('three test accounts registered for event notifications', Boolean(id1 && id2 && id3));

    // 1. Initial event preferences check
    const p1Res = await u1.notifications.getPreferences(u1.options);
    check(
      'default event notification preferences are enabled',
      p1Res.eventInvitations === true && p1Res.eventUpdates === true,
      JSON.stringify(p1Res),
    );

    // 2. User 2 creates draft event inviting User 1
    const draftRes = await u2.call('/api/v1/events', {
      method: 'POST',
      body: {
        title: '自动化架构研讨会',
        description: '讨论通知系统与状态机',
        location: '线上会议室',
        timezone: 'Asia/Shanghai',
        attendeePrincipalIds: [id1],
      },
    });
    check('user 2 creates draft event', draftRes.status === 201, JSON.stringify(draftRes.body));
    const eventId = String(record(draftRes.body).id);

    // Draft should NOT produce any notifications
    const u1ListBefore = await u1.notifications.list({}, u1.options);
    check('draft event produces zero notifications for attendee', u1ListBefore.data.length === 0);

    // 3. User 2 proposes time for the event
    const startAt = new Date(Date.now() + 86400000).toISOString();
    const endAt = new Date(Date.now() + 90000000).toISOString();
    const proposeRes = await u2.call(`/api/v1/events/${eventId}/proposals`, {
      method: 'POST',
      body: {
        startAt,
        endAt,
        timezone: 'Asia/Shanghai',
        expectedVersion: 1,
      },
    });
    check('user 2 proposes time', proposeRes.status === 200, JSON.stringify(proposeRes.body));

    // Wait for worker to deliver notification to User 1
    await waitFor(async () => {
      const list = await u1.notifications.list({}, u1.options);
      return list.data.some(
        (n) => n.target.type === 'event' && n.target.id === eventId && n.kind === 'proposed',
      );
    }, 'proposed event notification delivery');

    const u1Notifications = await u1.notifications.list({}, u1.options);
    const proposeNotification = u1Notifications.data.find(
      (n) => n.target.type === 'event' && n.target.id === eventId && n.kind === 'proposed',
    );
    check(
      'user 1 receives event proposed notification with type=event and correct eventId',
      Boolean(proposeNotification),
      JSON.stringify(u1Notifications.data),
    );

    // Verify metadata-only: notification should NOT contain title, description, or location
    check(
      'event notification omits private title/location fields',
      !('title' in record(proposeNotification)) &&
        !('description' in record(proposeNotification)) &&
        !('location' in record(proposeNotification)),
    );

    // Proposer (User 2) should NOT receive the proposed notification
    const u2NotificationsAfterPropose = await u2.notifications.list({}, u2.options);
    check(
      'proposer (user 2) does not receive proposed notification',
      !u2NotificationsAfterPropose.data.some(
        (n) => n.target.id === eventId && n.kind === 'proposed',
      ),
    );

    // Outsider (User 3) sees 0 notifications
    const u3Notifications = await u3.notifications.list({}, u3.options);
    check('outsider user 3 sees zero event notifications', u3Notifications.data.length === 0);

    // 4. User 1 marks the notification as read
    if (proposeNotification) {
      const readRes = await u1.notifications.read(proposeNotification.id, u1.options);
      check('user 1 marks notification read', readRes.readAt !== null, JSON.stringify(readRes));
    }

    // 5. User 1 accepts proposal -> All accepted -> Event becomes confirmed
    const acceptRes = await u1.call(`/api/v1/events/${eventId}/responses`, {
      method: 'POST',
      body: {
        response: 'accepted',
        expectedVersion: 2,
      },
    });
    check(
      'user 1 accepts proposal',
      acceptRes.status === 200 && nested(acceptRes.body, ['status']) === 'confirmed',
    );

    // Wait for confirmed notification delivery to both User 1 and User 2
    await waitFor(async () => {
      const list1 = await u1.notifications.list({}, u1.options);
      const list2 = await u2.notifications.list({}, u2.options);
      return (
        list1.data.some(
          (n) => n.target.type === 'event' && n.target.id === eventId && n.kind === 'confirmed',
        ) &&
        list2.data.some(
          (n) => n.target.type === 'event' && n.target.id === eventId && n.kind === 'confirmed',
        )
      );
    }, 'confirmed event notification delivery to both participants');

    check('both user 1 and user 2 receive event confirmed notification', true);

    // 6. User 2 cancels event
    const cancelRes = await u2.call(`/api/v1/events/${eventId}/cancel`, {
      method: 'POST',
      body: { reason: '测试取消通知' },
    });
    check('user 2 cancels event', cancelRes.status === 200);

    // Wait for cancelled notification delivery to User 1
    await waitFor(async () => {
      const list = await u1.notifications.list({}, u1.options);
      return list.data.some(
        (n) => n.target.type === 'event' && n.target.id === eventId && n.kind === 'cancelled',
      );
    }, 'cancelled event notification delivery to attendee');

    const u1AfterCancel = await u1.notifications.list({}, u1.options);
    check(
      'user 1 receives event cancelled notification',
      u1AfterCancel.data.some((n) => n.target.id === eventId && n.kind === 'cancelled'),
    );

    const u2AfterCancel = await u2.notifications.list({}, u2.options);
    check(
      'canceller (user 2) does not receive event cancelled notification',
      !u2AfterCancel.data.some((n) => n.target.id === eventId && n.kind === 'cancelled'),
    );

    // 7. Test preference suppression for event invitations
    const updatedPref = await u1.notifications.updatePreferences(
      {
        connectionInvitations: true,
        connectionUpdates: true,
        eventInvitations: false,
        eventUpdates: true,
        expectedVersion: p1Res.version,
      },
      u1.options,
    );
    check('user 1 updates eventInvitations to false', updatedPref.eventInvitations === false);

    // User 2 creates another draft and proposes time
    const draft2Res = await u2.call('/api/v1/events', {
      method: 'POST',
      body: {
        title: '已屏蔽测试研讨会',
        description: '验证偏好设置生效',
        location: '线上',
        timezone: 'Asia/Shanghai',
        attendeePrincipalIds: [id1],
      },
    });
    const event2Id = String(record(draft2Res.body).id);
    await u2.call(`/api/v1/events/${event2Id}/proposals`, {
      method: 'POST',
      body: {
        startAt: new Date(Date.now() + 172800000).toISOString(),
        endAt: new Date(Date.now() + 176400000).toISOString(),
        timezone: 'Asia/Shanghai',
        expectedVersion: 1,
      },
    });

    // Wait for delivery to be processed as suppressed in database
    await waitFor(async () => {
      const row = await admin.query<{ status: string }>(
        `SELECT d.status FROM public.notification_deliveries d
         JOIN public.event_coordination_events e ON e.id = d.coordination_event_id
         WHERE e.event_id = $1 AND d.recipient_user_id = $2`,
        [event2Id, id1],
      );
      return row.rows[0]?.status === 'suppressed';
    }, 'preference suppression of event proposal');

    check('suppressed event delivery is marked suppressed in database', true);

    const u1ListAfterSuppression = await u1.notifications.list({}, u1.options);
    check(
      'suppressed notification does not appear in user 1 inbox',
      !u1ListAfterSuppression.data.some((n) => n.target.id === event2Id),
    );
  } finally {
    await runtime.close();
    await app.close();
    await pool.end();
    await admin.end();
    await appPool.end();
  }

  if (failed > 0) {
    console.error(`\nFAILED: ${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll event notification checks passed cleanly!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
