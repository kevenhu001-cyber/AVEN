import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createApplicationPool,
  createPool,
  withRequestContext,
} from '../packages/database/dist/index.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AppModule } from '../apps/api/dist/app.module.js';
import { createApiClient, ApiClientError } from '../packages/api-client/dist/index.js';

import { deliverNotification, failNotification } from '../packages/domain/dist/index.js';
import { createNotificationRuntime } from '../apps/worker/dist/notification.js';
import { OutboxDispatcher } from '../apps/worker/dist/outbox.js';

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
  private readonly baseUrl: string;
  readonly connections: ReturnType<typeof createApiClient>['connections'];
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
    this.connections = api.connections;
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
  if (process.env.NODE_ENV === 'production') throw new Error('Development verification only.');
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
  const port = typeof address === 'object' && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  const [a, b, c, operator] = Array.from({ length: 4 }, () => new Client(origin)) as [
    Client,
    Client,
    Client,
    Client,
  ];
  const anon = new Client(origin);
  const pool = createPool('aven_worker');
  const admin = createPool('aven_migrator');
  const appPool = createApplicationPool();
  const runtime = createNotificationRuntime(pool, () => undefined);
  let operatorUserId: string | undefined;
  let faultsInstalled = false;
  async function waitFor(test: () => Promise<boolean>, label: string) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Verification timeout: ${label}`);
  }
  async function state(id: string) {
    const r = await admin.query<{ status: string; attempts: number; generation: number }>(
      'SELECT status,attempts,generation FROM public.notification_deliveries WHERE event_id=$1',
      [id],
    );
    return r.rows[0];
  }
  async function event(invitation: string, kind = 'sent') {
    const r = await admin.query<{ id: string }>(
      'SELECT id FROM public.connection_events WHERE invitation_id=$1 AND event_type=$2 ORDER BY created_at DESC LIMIT 1',
      [invitation, kind],
    );
    if (!r.rows[0]) throw new Error('Missing source event.');
    return r.rows[0].id;
  }
  async function memory(client: Client) {
    const res = await client.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'interest',
        title: '开发通知样例',
        content: '不得复制到通知的开发私人正文',
        allowedUses: ['sharing'],
      },
    });
    if (res.status !== 201) throw new Error('Memory setup failed.');
    return String(record(res.body).id);
  }
  async function send(sender: Client, recipient: string) {
    const mem = await memory(sender);
    const preview = await sender.connections.preview(
      { recipientUserId: recipient, memoryItemIds: [mem] },
      sender.options,
    );
    const key = randomUUID();
    const invitation = await sender.connections.send(preview.id, key, sender.options);
    return { invitation, mem, preview, key, eventId: await event(invitation.id) };
  }
  async function errorStatus(work: () => Promise<unknown>, status: number) {
    try {
      await work();
      return false;
    } catch (error) {
      return error instanceof ApiClientError && error.status === status;
    }
  }
  async function dbDenied(work: () => Promise<unknown>) {
    try {
      await work();
      return false;
    } catch (error) {
      return (
        typeof error === 'object' && error !== null && 'code' in error && error.code === '42501'
      );
    }
  }
  try {
    const run = randomUUID().slice(0, 8);
    const ids: string[] = [];
    for (const [i, client] of [a, b, c, operator].entries())
      ids.push(
        await client.register(
          `notification.${i}.${run}@example.test`,
          `开发通知用户${i}`,
          'StrongPassword!123',
        ),
      );
    const [aid, bid, cid, oid] = ids as [string, string, string, string];
    operatorUserId = oid;
    check(
      'four independent accounts registered',
      ids.every((id) => /^[0-9a-f-]{36}$/.test(id)),
    );
    check(
      'anonymous notification reads rejected',
      (await anon.call('/api/v1/notifications')).status === 401,
    );
    check(
      'default preferences are enabled at version zero',
      (await b.notifications.getPreferences(b.options)).version === 0,
    );
    check(
      'incomplete cursor rejected',
      (await b.call(`/api/v1/notifications?cursorId=${randomUUID()}`)).status === 422,
    );
    check(
      'invalid page size rejected',
      (await b.call('/api/v1/notifications?limit=101')).status === 422,
    );
    check(
      'identity injection rejected',
      (await b.call(`/api/v1/notifications?recipientUserId=${aid}`)).status === 422,
    );
    check(
      'preference writes require CSRF',
      (
        await b.call('/api/v1/notifications/preferences', {
          method: 'POST',
          csrf: false,
          body: { connectionInvitations: true, connectionUpdates: true, expectedVersion: 0 },
        })
      ).status === 403,
    );
    check(
      'normal users cannot inspect dead letters',
      (await b.call('/api/v1/notifications/deliveries/dead')).status === 403,
    );
    check(
      'app cannot consume a worker job',
      await dbDenied(() =>
        appPool.query('SELECT app.deliver_notification($1,0,1)', [randomUUID()]),
      ),
    );
    check(
      'forged worker context cannot consume',
      await dbDenied(() =>
        withRequestContext(appPool, {}, async (client) => {
          await client.query("SELECT set_config('app.is_worker','true',true)");
          return client.query('SELECT app.deliver_notification($1,0,1)', [randomUUID()]);
        }),
      ),
    );
    check(
      'app cannot insert inbox records',
      await dbDenied(() =>
        appPool.query(
          "INSERT INTO public.notifications(event_id,recipient_user_id,invitation_id,kind) VALUES($1,$2,$3,'sent')",
          [randomUUID(), bid, randomUUID()],
        ),
      ),
    );

    const one = await send(a, bid);
    const source = await admin.query<{ payload: unknown }>(
      "SELECT payload FROM public.outbox_events WHERE id=$1 AND event_type='notification.requested'",
      [one.eventId],
    );
    check(
      'outbox contains only the committed event ID',
      JSON.stringify(source.rows[0]?.payload) === JSON.stringify({ eventId: one.eventId }),
    );
    check(
      'before dispatch no inbox row exists',
      (await b.notifications.list({}, b.options)).data.length === 0,
    );
    await a.connections.send(one.preview.id, one.key, a.options);
    const duplicateSource = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.notification_deliveries WHERE event_id=$1',
      [one.eventId],
    );
    check('send replay creates one notification intent', duplicateSource.rows[0]?.count === '1');
    const rollbackPreview = await a.connections.preview(
      { recipientUserId: cid, memoryItemIds: [one.mem] },
      a.options,
    );
    let rolledId = '';
    try {
      await withRequestContext(appPool, { userId: aid, principalId: aid }, async (client) => {
        const r = await client.query<{ result: { id: string } }>(
          'SELECT app.send_connection_invitation($1,$2) AS result',
          [rollbackPreview.id, randomUUID()],
        );
        rolledId = r.rows[0]?.result.id ?? '';
        throw new Error('EXPECTED_ROLLBACK');
      });
    } catch {
      /* Expected rollback after all business writes. */
    }
    const rolled = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.outbox_events WHERE aggregate_id=$1',
      [rolledId],
    );
    check(
      'business rollback rolls back notification intent',
      rolledId !== '' && rolled.rows[0]?.count === '0',
    );

    await runtime.start();
    await waitFor(async () => (await state(one.eventId))?.status === 'delivered', 'first delivery');
    const inbox = await b.notifications.list({}, b.options);
    const first = inbox.data.find((n) => n.target.id === one.invitation.id);
    if (!first) throw new Error('First notification missing.');
    check(
      'real Redis queue delivers to the other account',
      first.kind === 'sent' && inbox.unreadCount === 1,
    );
    check(
      'notification has no private body or identity fields',
      !JSON.stringify(inbox).includes('开发私人正文') &&
        Object.keys(first).sort().join(',') === 'createdAt,id,kind,readAt,target',
    );
    check(
      'sender does not receive its own sent notification',
      (await a.notifications.list({}, a.options)).data.length === 0,
    );
    check(
      'outsider cannot mark notification read',
      await errorStatus(() => c.notifications.read(first.id, c.options), 404),
    );
    const raw = await withRequestContext(appPool, { userId: cid, principalId: cid }, (client) =>
      client.query('SELECT id FROM public.notifications WHERE id=$1', [first.id]),
    );
    check('RLS filters another recipients inbox', raw.rowCount === 0);
    const oracle = await withRequestContext(appPool, { userId: aid, principalId: aid }, (client) =>
      client.query<{ visible: boolean }>(
        "SELECT app.connection_notification_visible($1,$2,'sent') AS visible",
        [one.invitation.id, bid],
      ),
    );
    check('visibility helper cannot probe another recipient', oracle.rows[0]?.visible === false);
    const read = await Promise.all([
      b.notifications.read(first.id, b.options),
      b.notifications.read(first.id, b.options),
    ]);
    check(
      'concurrent read retains first read timestamp',
      read[0]?.readAt !== null && read[0]?.readAt === read[1]?.readAt,
    );
    check(
      'unread count changes after reading',
      (await b.notifications.list({}, b.options)).unreadCount === 0,
    );
    const mobile = await b.call('/api/v1/auth/login', {
      method: 'POST',
      csrf: false,
      body: {
        email: `notification.1.${run}@example.test`,
        password: 'StrongPassword!123',
        client: 'mobile',
      },
    });
    const mobileCall = {
      auth: { kind: 'mobile' as const, bearerToken: String(record(mobile.body).sessionToken) },
    };
    check(
      'mobile bearer reads same account inbox',
      (await b.notifications.list({}, mobileCall)).data.some((n) => n.id === first.id),
    );
    await Promise.all([
      deliverNotification(pool, { eventId: one.eventId, generation: 0 }, 1),
      deliverNotification(pool, { eventId: one.eventId, generation: 0 }, 1),
    ]);
    const dedup = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.notifications WHERE event_id=$1',
      [one.eventId],
    );
    check('duplicate concurrent consumption stores one row', dedup.rows[0]?.count === '1');
    let forgedRejected = false;
    try {
      await deliverNotification(
        pool,
        { eventId: one.eventId, generation: 0, recipientUserId: cid },
        1,
      );
    } catch {
      forgedRejected = true;
    }
    check('queue identity injection rejected', forgedRejected);
    check(
      'unknown event never creates a notification',
      (await deliverNotification(pool, { eventId: randomUUID(), generation: 0 }, 1)) === 'ignored',
    );

    await b.connections.decide(
      one.invitation.id,
      { decision: 'accepted', expectedVersion: 1 },
      b.options,
    );
    const acceptedEvent = await event(one.invitation.id, 'accepted');
    await waitFor(async () => (await state(acceptedEvent))?.status === 'delivered', 'acceptance');
    check(
      'acceptance notifies original sender',
      (await a.notifications.list({}, a.options)).data.some(
        (n) => n.kind === 'accepted' && n.target.id === one.invitation.id,
      ),
    );
    check(
      'handled invitation disappears from receiver pending inbox',
      !(await b.notifications.list({}, b.options)).data.some((n) => n.id === first.id),
    );
    check(
      'hidden notification cannot be marked read',
      await errorStatus(() => b.notifications.read(first.id, b.options), 404),
    );

    await a.connections.revoke(one.invitation.id, a.options);
    const revokedEvent = await event(one.invitation.id, 'revoked');
    await waitFor(
      async () => (await state(revokedEvent))?.status === 'delivered',
      'revocation notice',
    );
    check(
      'revocation informs recipient through metadata only',
      (await b.notifications.list({}, b.options)).data.some(
        (n) => n.kind === 'revoked' && n.target.id === one.invitation.id,
      ),
    );

    const pref = await c.notifications.updatePreferences(
      { connectionInvitations: false, connectionUpdates: true, expectedVersion: 0 },
      c.options,
    );
    check('preference update advances version', pref.version === 1 && !pref.connectionInvitations);
    check(
      'stale preference version conflicts',
      await errorStatus(
        () =>
          c.notifications.updatePreferences(
            { connectionInvitations: true, connectionUpdates: true, expectedVersion: 0 },
            c.options,
          ),
        409,
      ),
    );
    const muted = await a.connections.send(rollbackPreview.id, randomUUID(), a.options);
    const mutedEvent = await event(muted.id);
    await waitFor(
      async () => (await state(mutedEvent))?.status === 'suppressed',
      'muted invitation',
    );
    check(
      'delivery checks current preference',
      (await c.notifications.list({}, c.options)).data.length === 0,
    );
    await c.notifications.updatePreferences(
      { connectionInvitations: true, connectionUpdates: true, expectedVersion: 1 },
      c.options,
    );
    check(
      'reenabling does not replay suppressed notifications',
      (await deliverNotification(pool, { eventId: mutedEvent, generation: 0 }, 1)) === 'suppressed',
    );

    await c.connections.decide(muted.id, { decision: 'declined', expectedVersion: 1 }, c.options);
    const declinedEvent = await event(muted.id, 'declined');
    await waitFor(
      async () => (await state(declinedEvent))?.status === 'delivered',
      'decline notice',
    );
    check(
      'independent decline notifies sender',
      (await a.notifications.list({}, a.options)).data.some(
        (n) => n.kind === 'declined' && n.target.id === muted.id,
      ),
    );
    const preferenceRace = await Promise.all([
      operator.call('/api/v1/notifications/preferences', {
        method: 'POST',
        body: { connectionInvitations: true, connectionUpdates: true, expectedVersion: 0 },
      }),
      operator.call('/api/v1/notifications/preferences', {
        method: 'POST',
        body: { connectionInvitations: true, connectionUpdates: true, expectedVersion: 0 },
      }),
    ]);
    check(
      'concurrent preference update has one version winner',
      preferenceRace.filter((r) => r.status === 200).length === 1 &&
        preferenceRace.filter((r) => r.status === 409).length === 1,
    );

    await runtime.dispatcher.stop();
    const withdrawn = await send(a, oid);
    await a.connections.withdraw(withdrawn.invitation.id, 1, a.options);
    const withdrawnEvent = await event(withdrawn.invitation.id, 'withdrawn');
    await runtime.dispatcher.dispatchOnce();
    await waitFor(async () => (await state(withdrawnEvent))?.status === 'delivered', 'withdrawal');
    check(
      'withdraw before delivery suppresses stale invitation',
      (await state(withdrawn.eventId))?.status === 'suppressed',
    );
    check(
      'withdrawal informs recipient without private content',
      (await operator.notifications.list({}, operator.options)).data.some(
        (n) => n.kind === 'withdrawn',
      ),
    );
    const expired = await send(c, bid);
    await admin.query(
      "UPDATE public.connection_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [expired.invitation.id],
    );
    await runtime.dispatcher.dispatchOnce();
    await waitFor(
      async () => (await state(expired.eventId))?.status === 'suppressed',
      'expired invitation',
    );
    check(
      'queued expired invitation suppressed',
      !(await b.notifications.list({}, b.options)).data.some(
        (n) => n.target.id === expired.invitation.id,
      ),
    );
    await a.connections.revoke(muted.id, a.options);
    const tightened = await send(c, aid);
    await c.call(`/api/v1/memories/${tightened.mem}`, {
      method: 'PATCH',
      body: { expectedVersion: 1, allowedUses: [] },
    });
    await runtime.dispatcher.dispatchOnce();
    await waitFor(
      async () => (await state(tightened.eventId))?.status === 'suppressed',
      'source revocation',
    );
    check(
      'queued source invalidation suppresses invitation',
      !(await a.notifications.list({}, a.options)).data.some(
        (n) => n.target.id === tightened.invitation.id,
      ),
    );

    const broken = await send(a, oid);
    await admin.query(`CREATE TABLE app.notification_test_faults(event_id uuid PRIMARY KEY);
      CREATE FUNCTION app.notification_test_fail() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
      BEGIN IF EXISTS(SELECT 1 FROM app.notification_test_faults WHERE event_id=NEW.event_id) THEN RAISE EXCEPTION 'TEST_DELIVERY_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER trg_notification_test_fail BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION app.notification_test_fail()`);
    faultsInstalled = true;
    await admin.query('INSERT INTO app.notification_test_faults VALUES($1)', [broken.eventId]);
    await runtime.dispatcher.dispatchOnce();
    await waitFor(async () => (await state(broken.eventId))?.status === 'dead', 'five failures');
    check(
      'five real queue failures enter dead letter state',
      (await state(broken.eventId))?.attempts === 5,
    );
    check(
      'notification failure leaves invitation pending',
      (await a.connections.getInvitation(broken.invitation.id, a.options)).status === 'pending',
    );
    check(
      'normal user cannot replay dead letter',
      await errorStatus(() => b.notifications.retry(broken.eventId, 0, b.options), 403),
    );
    await admin.query(
      "INSERT INTO public.platform_role_assignments(user_id,role,status) VALUES($1,'platform_admin','active')",
      [oid],
    );
    const dead = await operator.notifications.listDead(operator.options);
    check(
      'current platform admin reads safe dead letter metadata',
      dead.data.some((n) => n.id === broken.eventId && n.attempts === 5) &&
        !JSON.stringify(dead).includes('recipientUserId'),
    );
    check(
      'dead letter replay requires CSRF',
      (
        await operator.call(`/api/v1/notifications/deliveries/${broken.eventId}/retry`, {
          method: 'POST',
          csrf: false,
          body: { expectedGeneration: 0 },
        })
      ).status === 403,
    );
    check(
      'dead letter replay checks generation',
      await errorStatus(
        () => operator.notifications.retry(broken.eventId, 99, operator.options),
        409,
      ),
    );
    await admin.query('DELETE FROM app.notification_test_faults WHERE event_id=$1', [
      broken.eventId,
    ]);
    const retries = await Promise.all([
      operator.call(`/api/v1/notifications/deliveries/${broken.eventId}/retry`, {
        method: 'POST',
        body: { expectedGeneration: 0 },
      }),
      operator.call(`/api/v1/notifications/deliveries/${broken.eventId}/retry`, {
        method: 'POST',
        body: { expectedGeneration: 0 },
      }),
    ]);
    check(
      'concurrent replay creates one new generation',
      retries.filter((r) => r.status === 200).length === 1 &&
        retries.filter((r) => r.status === 409).length === 1,
    );
    await failNotification(pool, { eventId: broken.eventId, generation: 0 }, 5);
    check(
      'late failure cannot kill a newer generation',
      (await state(broken.eventId))?.generation === 1 &&
        (await state(broken.eventId))?.status === 'pending',
    );
    check(
      'old generation job is ignored',
      (await deliverNotification(pool, { eventId: broken.eventId, generation: 0 }, 1)) ===
        'ignored',
    );
    await runtime.dispatcher.dispatchOnce();
    await waitFor(
      async () => (await state(broken.eventId))?.status === 'delivered',
      'admin replay delivery',
    );
    const audit = await admin.query<{ count: string; actor: string }>(
      "SELECT count(*)::text AS count,min(actor_user_id::text) AS actor FROM public.notification_delivery_events WHERE event_id=$1 AND event_type='retried'",
      [broken.eventId],
    );
    check(
      'manual replay writes one actor-bound audit record',
      audit.rows[0]?.count === '1' && audit.rows[0]?.actor === oid,
    );
    check(
      'replayed dead letter produces one notification',
      (await operator.notifications.list({}, operator.options)).data.filter(
        (n) => n.target.id === broken.invitation.id && n.kind === 'sent',
      ).length === 1,
    );

    const lost = await send(b, oid);
    await admin.query(
      "UPDATE public.outbox_events SET status='processed',processed_at=clock_timestamp()-interval '60 seconds' WHERE id=$1",
      [lost.eventId],
    );
    await admin.query(
      "UPDATE public.notification_deliveries SET last_queued_at=clock_timestamp()-interval '60 seconds' WHERE event_id=$1",
      [lost.eventId],
    );
    check(
      'reconciliation requeues a lost processed event',
      (await runtime.dispatcher.reconcile()) >= 1,
    );
    await waitFor(
      async () => (await state(lost.eventId))?.status === 'delivered',
      'lost job recovery',
    );
    check(
      'lost queue job recovers from durable receipt',
      (await operator.notifications.list({}, operator.options)).data.some(
        (n) => n.target.id === lost.invitation.id,
      ),
    );

    const crash = await send(b, cid);
    const crashDispatcher = new OutboxDispatcher(pool, undefined, () => undefined, {
      eventType: 'notification.requested',
      batchSize: 1,
      enqueue: async (row) => {
        const current = await state(row.id);
        if (!current || current.status !== 'pending') return;
        await runtime.queue.add(
          'fault-replay',
          { eventId: row.id, generation: current.generation },
          {
            jobId: `${row.id}-fault`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 500 },
            removeOnComplete: false,
          },
        );
      },
    });
    let crashed = false;
    try {
      await crashDispatcher.dispatchOnce({ crashAfterEnqueue: true });
    } catch {
      crashed = true;
    }
    await admin.query(
      "UPDATE public.outbox_events SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND status='processing'",
      [crash.eventId],
    );
    await crashDispatcher.dispatchOnce();
    await waitFor(
      async () => (await state(crash.eventId))?.status === 'delivered',
      'crash recovery',
    );
    const crashCount = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.notifications WHERE event_id=$1',
      [crash.eventId],
    );
    check(
      'enqueue before crash recovers without duplicate side effect',
      crashed && crashCount.rows[0]?.count === '1',
    );

    const page1 = await operator.notifications.list({ limit: 1 }, operator.options);
    const cursor = page1.nextCursor;
    if (!cursor) throw new Error('Missing pagination cursor.');
    const page2 = await operator.notifications.list(
      { limit: 1, cursorCreatedAt: cursor.createdAt, cursorId: cursor.id },
      operator.options,
    );
    check(
      'stable keyset pagination has no duplicate item',
      page1.data.length === 1 && page2.data.length === 1 && page1.data[0]?.id !== page2.data[0]?.id,
    );
    await admin.query(
      "UPDATE public.notifications SET created_at=clock_timestamp()-interval '91 days' WHERE event_id=$1",
      [acceptedEvent],
    );
    check(
      'expired inbox entries are not returned',
      !(await a.notifications.list({}, a.options)).data.some(
        (n) => n.target.id === one.invitation.id && n.kind === 'accepted',
      ),
    );
    const purged = await pool.query<{ count: number }>(
      'SELECT app.purge_old_notifications(1000) AS count',
    );
    check('notification retention removes old inbox rows', (purged.rows[0]?.count ?? 0) >= 1);
    await deliverNotification(pool, { eventId: acceptedEvent, generation: 0 }, 1);
    const retained = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.notifications WHERE event_id=$1',
      [acceptedEvent],
    );
    check(
      'retention preserves receipt and does not resurrect old notification',
      retained.rows[0]?.count === '0',
    );
    await admin.query(
      "UPDATE public.platform_role_assignments SET status='revoked',revoked_at=clock_timestamp() WHERE user_id=$1",
      [oid],
    );
    check(
      'removed platform role blocks dead letter access',
      await errorStatus(() => operator.notifications.listDead(operator.options), 403),
    );
    await admin.query("UPDATE public.principals SET status='suspended' WHERE id=$1", [bid]);
    check(
      'suspended sender removes related notices from current reads',
      !(await operator.notifications.list({}, operator.options)).data.some(
        (n) => n.target.id === lost.invitation.id,
      ),
    );
    await admin.query("UPDATE public.principals SET status='active' WHERE id=$1", [bid]);
    const rls = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_class WHERE relname IN('notifications','notification_preferences','notification_deliveries','notification_delivery_events') AND relrowsecurity AND relforcerowsecurity",
    );
    check('four notification tables force RLS', rls.rows[0]?.count === '4');
  } finally {
    await runtime.close();
    if (faultsInstalled)
      await admin.query(
        'DROP TRIGGER IF EXISTS trg_notification_test_fail ON public.notifications; DROP FUNCTION IF EXISTS app.notification_test_fail(); DROP TABLE IF EXISTS app.notification_test_faults',
      );
    if (operatorUserId)
      await admin.query(
        "UPDATE public.platform_role_assignments SET status='revoked',revoked_at=clock_timestamp() WHERE user_id=$1",
        [operatorUserId],
      );
    await app.close();
    await Promise.all([pool.end(), admin.end(), appPool.end()]);
  }
  if (failed) throw new Error(`${failed} notification checks failed.`);
  console.log('All notification verification checks passed.');
}
main().catch((error) => {
  if (error instanceof ApiClientError)
    console.error('Verification API error:', error.status, error.apiCode);
  console.error(error instanceof Error ? error.message : 'Notification verification failed.');
  process.exitCode = 1;
});
