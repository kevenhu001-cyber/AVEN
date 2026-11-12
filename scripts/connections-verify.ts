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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.connections = createApiClient({
      baseUrl,
      fetcher: async (url, init) => {
        const headers = new Headers(init?.headers);
        if (init?.credentials === 'include') headers.set('cookie', this.cookieHeader());
        return fetch(url, { ...init, headers });
      },
    }).connections;
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
  clearRateLimits();
  const env = parseApiEnvironment(process.env);
  const app = await createApiApplication(env, () => undefined, AppModule, {
    check: async () => ({
      ok: true,
      checks: { database: true, redis: true, migrations: true },
      retryable: false,
    }),
  });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const clients = Array.from({ length: 4 }, () => new Client(`http://127.0.0.1:${port}`));
  const pool = createApplicationPool();
  const admin = createPool('aven_migrator');
  const [a, b, c, d] = clients as [Client, Client, Client, Client];
  const base = '/api/v1/connections';
  const body = (res: { body: unknown }) => record(res.body);
  const items = (res: { body: unknown }) =>
    Array.isArray(body(res).items) ? (body(res).items as unknown[]) : [];
  try {
    const ids: string[] = [];
    const run = randomUUID().slice(0, 8);
    for (const [i, client] of clients.entries())
      ids.push(
        await client.register(
          `connection.${i}.${run}@example.test`,
          `开发连接用户${i}`,
          'StrongPassword!123',
        ),
      );
    const [aid, bid, cid, did] = ids as [string, string, string, string];
    const mobileLogin = await b.call('/api/v1/auth/login', {
      method: 'POST',
      csrf: false,
      body: {
        email: `connection.1.${run}@example.test`,
        password: 'StrongPassword!123',
        client: 'mobile',
      },
    });
    const mobileOptions = {
      auth: { kind: 'mobile' as const, bearerToken: String(body(mobileLogin).sessionToken) },
    };
    check(
      'receiver has an independent mobile bearer session',
      mobileLogin.status === 200 && typeof body(mobileLogin).sessionToken === 'string',
    );
    check(
      'four independent real accounts have sessions',
      ids.every((id) => /^[0-9a-f-]{36}$/.test(id)),
    );
    async function memory(client: Client, uses: string[] = ['sharing']) {
      const r = await client.call('/api/v1/memories', {
        method: 'POST',
        body: {
          kind: 'interest',
          title: '开发样例兴趣',
          content: '允许分享的机器人兴趣',
          allowedUses: uses,
        },
      });
      if (r.status !== 201) throw new Error(`Memory setup failed (${r.status}).`);
      return String(body(r).id);
    }
    const mid = await memory(a),
      privateMid = await memory(a, []),
      cmid = await memory(c),
      dmid = await memory(d);
    async function preview(client: Client, recipient: string, mem = mid) {
      return client.call(`${base}/previews`, {
        method: 'POST',
        body: { recipientUserId: recipient, memoryItemIds: [mem] },
      });
    }
    async function send(client: Client, p: string, key = randomUUID()) {
      return client.call(`${base}/invitations`, {
        method: 'POST',
        idempotencyKey: key,
        body: { previewId: p },
      });
    }
    async function snap(client: Client, id: string) {
      return client.call(`${base}/invitations/${id}/snapshot`);
    }
    async function decision(
      client: Client,
      id: string,
      decision = 'accepted',
      expectedVersion = 1,
    ) {
      return client.call(`${base}/invitations/${id}/decision`, {
        method: 'POST',
        body: { decision, expectedVersion },
      });
    }
    const anon = new Client(`http://127.0.0.1:${port}`);
    check(
      'unauthenticated access rejected',
      (await anon.call(`${base}/invitations`)).status === 401,
    );
    check(
      'missing CSRF rejected',
      (
        await a.call(`${base}/previews`, {
          method: 'POST',
          csrf: false,
          body: { recipientUserId: bid, memoryItemIds: [mid] },
        })
      ).status === 403,
    );
    check('self invitation rejected', (await preview(a, aid)).status === 422);
    check(
      'unknown recipient does not leak profile',
      (await preview(a, randomUUID())).status === 404,
    );
    check(
      'missing sharing permission rejected',
      (await preview(a, bid, privateMid)).status === 422,
    );
    check('another user source rejected', (await preview(c, bid, mid)).status === 422);
    const p = await preview(a, bid);
    const pid = String(body(p).id);
    check(
      'preview includes selected actual value and purpose',
      p.status === 201 &&
        body(p).purpose === 'connection_invitation' &&
        JSON.stringify(body(p).snapshot).includes('允许分享的机器人兴趣'),
    );
    check(
      'preview does not deliver invitation',
      !JSON.stringify((await b.call(`${base}/invitations`)).body).includes(pid),
    );
    check('preview cannot be consumed by another actor', (await send(c, pid)).status === 404);
    check(
      'send requires idempotency key',
      (await a.call(`${base}/invitations`, { method: 'POST', body: { previewId: pid } })).status ===
        422,
    );
    const key = randomUUID();
    const sent = await send(a, pid, key);
    const invite = String(body(sent).id);
    check(
      'confirmed send creates pending invitation',
      sent.status === 201 &&
        body(sent).status === 'pending' &&
        body(sent).recipientDecidedAt === null,
      JSON.stringify(sent.body),
    );
    check(
      'metadata omits private contents',
      !JSON.stringify(sent.body).includes('机器人兴趣') && !('senderName' in body(sent)),
    );
    const retry = await send(a, pid, key);
    check(
      'same key retries return same invitation',
      retry.status === 201 && body(retry).id === invite,
    );
    check(
      'typed client preserves send idempotency',
      (await a.connections.send(pid, key, a.options)).id === invite,
    );
    const typedPreview = await a.connections.preview(
      { recipientUserId: bid, memoryItemIds: [mid] },
      a.options,
    );
    check(
      'typed client validates a real preview response',
      typedPreview.snapshot.length === 1 && typedPreview.recipientUserId === bid,
    );
    const senderWidget = await a.connections.getWidget(invite, a.options);
    const recipientWidget = await b.connections.getWidget(invite, b.options);
    check(
      'widget roles derive independently from real sessions',
      senderWidget.role === 'sender' && recipientWidget.role === 'recipient',
    );
    check(
      'widget reads only currently authorized selected contents',
      recipientWidget.snapshot.items.length === 1 &&
        recipientWidget.snapshot.items[0]?.sourceId === mid &&
        recipientWidget.invitation.status === 'pending',
    );
    check(
      'unrelated session cannot read a widget',
      (await c.call(`${base}/invitations/${invite}/widget`)).status === 404,
    );
    check(
      'widget requires a real session',
      (await anon.call(`${base}/invitations/${invite}/widget`)).status === 401,
    );
    check(
      'mobile bearer reads the receiver widget without cookie credentials',
      (await b.connections.getWidget(invite, mobileOptions)).role === 'recipient',
    );
    check(
      'typed list and detail return current metadata',
      (await b.connections.listInvitations(b.options)).data.some((item) => item.id === invite) &&
        (await b.connections.getInvitation(invite, b.options)).version === 1,
    );
    check(
      'typed snapshot validates the real response',
      (await b.connections.getSnapshot(invite, b.options)).items.length === 1,
    );
    check('same preview cannot send under a fresh key', (await send(a, pid)).status === 409);
    const pOther = await preview(a, bid);
    check(
      'same key different preview conflicts',
      (await send(a, String(body(pOther).id), key)).status === 409,
    );
    check(
      'opposite invitation does not imply acceptance',
      (await send(b, String(body(await preview(b, aid, await memory(b))).id))).status === 409,
    );
    const received = await b.call(`${base}/invitations`);
    check(
      'recipient reads invitation through its own session',
      received.status === 200 && JSON.stringify(received.body).includes(invite),
    );
    check(
      'unrelated account sees no invitation',
      (await c.call(`${base}/invitations/${invite}`)).status === 404,
    );
    check('unrelated account cannot read snapshot', (await snap(c, invite)).status === 404);
    const snapshot = await snap(b, invite);
    check(
      'recipient reads only selected source snapshot',
      snapshot.status === 200 &&
        items(snapshot).length === 1 &&
        record(items(snapshot)[0]).sourceId === mid,
    );
    check('sender cannot decide as receiver', (await decision(a, invite)).status === 404);
    check(
      'wrong decision version conflicts',
      (await decision(b, invite, 'accepted', 99)).status === 409,
    );
    const update = await a.call(`/api/v1/memories/${mid}`, {
      method: 'PATCH',
      body: { expectedVersion: 1, content: '普通编辑后的机器人兴趣', allowedUses: ['sharing'] },
    });
    check(
      'normal edit does not rewrite old immutable snapshot',
      update.status === 200 &&
        JSON.stringify((await snap(b, invite)).body).includes('允许分享的机器人兴趣'),
    );
    const accepted = await Promise.all([decision(b, invite), decision(b, invite)]);
    check(
      'concurrent accepts are idempotent',
      accepted.every((r) => r.status === 200) &&
        body(accepted[0]!).connectionId === body(accepted[1]!).connectionId,
      JSON.stringify(accepted.map((r) => ({ status: r.status, body: r.body }))),
    );
    const connectionId = String(body(accepted[0]!).connectionId);
    check('atomic acceptance establishes one connection', /^[0-9a-f-]{36}$/.test(connectionId));
    const typedAccepted = await b.connections.decide(
      invite,
      { decision: 'accepted', expectedVersion: 1 },
      mobileOptions,
    );
    check(
      'typed decision replay returns the same established connection',
      typedAccepted.connectionId === connectionId &&
        (await b.connections.getWidget(invite, b.options)).invitation.status === 'accepted',
    );
    check(
      'typed client reads the established connection list',
      (await b.connections.listConnections(b.options)).data.some(
        (item) => item.id === connectionId,
      ),
    );
    await b.call(
      `/api/v1/auth/sessions/${String(nested(mobileLogin.body, ['session', 'id']))}/revoke`,
      { method: 'POST' },
    );
    let revokedMobileDenied = false;
    try {
      await b.connections.getWidget(invite, mobileOptions);
    } catch (error) {
      revokedMobileDenied = error instanceof ApiClientError && error.status === 401;
    }
    check('revoked mobile session cannot fall back to the web cookie', revokedMobileDenied);
    const al = await a.call(base),
      bl = await b.call(base),
      cl = await c.call(base);
    check(
      'both participants list their connection',
      JSON.stringify(al.body).includes(connectionId) &&
        JSON.stringify(bl.body).includes(connectionId),
    );
    check('outsider has no connection metadata', !JSON.stringify(cl.body).includes(connectionId));
    check(
      'recipient cannot revoke sender grant',
      (await b.call(`${base}/invitations/${invite}/revoke`, { method: 'POST' })).status === 404,
    );
    check(
      'sender revokes invitation consent',
      (await a.call(`${base}/invitations/${invite}/revoke`, { method: 'POST' })).status === 200,
    );
    check('revocation immediately hides the snapshot', items(await snap(b, invite)).length === 0);
    await a.connections.revoke(invite, a.options);
    const revokedWidget = await b.connections.getWidget(invite, b.options);
    check(
      'widget refresh after revocation contains no stale body',
      revokedWidget.snapshot.items.length === 0 &&
        revokedWidget.invitation.grantStatus === 'revoked',
    );
    check(
      'revoke retries do not duplicate action',
      (await a.call(`${base}/invitations/${invite}/revoke`, { method: 'POST' })).status === 200,
    );
    check(
      'send replay rechecks grant metadata',
      body(await send(a, pid, key)).grantStatus === 'revoked',
    );
    check(
      'connection remains without automatic relationship sharing',
      JSON.stringify((await b.call(base)).body).includes(connectionId),
    );
    const pc = await preview(a, cid);
    const sc = await send(a, String(body(pc).id));
    const ci = String(body(sc).id);
    check('recipient independently declines', (await decision(c, ci, 'declined')).status === 200);
    check('decline blocks future snapshot reads', items(await snap(c, ci)).length === 0);
    check(
      'declined widget is metadata only',
      (await c.connections.getWidget(ci, c.options)).snapshot.items.length === 0,
    );
    check('declined invitation cannot later be accepted', (await decision(c, ci)).status === 409);
    const withdrawPreview = await a.connections.preview(
      { recipientUserId: cid, memoryItemIds: [mid] },
      a.options,
    );
    const withdrawInvite = await a.connections.send(withdrawPreview.id, randomUUID(), a.options);
    const [widgetDuringWithdraw, withdrawn] = await Promise.all([
      c.connections.getWidget(withdrawInvite.id, c.options),
      a.connections.withdraw(withdrawInvite.id, withdrawInvite.version, a.options),
    ]);
    check(
      'widget racing withdrawal keeps metadata and snapshot consistent',
      (widgetDuringWithdraw.invitation.status === 'pending' &&
        widgetDuringWithdraw.snapshot.items.length === 1) ||
        (widgetDuringWithdraw.invitation.status === 'withdrawn' &&
          widgetDuringWithdraw.snapshot.items.length === 0),
    );
    check(
      'typed withdrawal changes state and hides widget contents',
      withdrawn.status === 'withdrawn' &&
        (await c.connections.getWidget(withdrawInvite.id, c.options)).snapshot.items.length === 0,
    );
    const pd = await preview(a, did);
    const sd = await send(a, String(body(pd).id));
    const di = String(body(sd).id);
    const race = await Promise.all([
      decision(d, di),
      a.call(`${base}/invitations/${di}/withdraw`, {
        method: 'POST',
        body: { expectedVersion: 1 },
      }),
    ]);
    check(
      'withdraw versus accept has exactly one winning state transition',
      race.filter((r) => r.status === 200).length === 1 &&
        race.filter((r) => r.status === 409).length === 1,
    );
    const final = body(await a.call(`${base}/invitations/${di}`));
    check(
      'race leaves consistent metadata',
      final.status === 'accepted'
        ? Boolean(final.connectionId)
        : final.status === 'withdrawn' &&
            final.connectionId === null &&
            items(await snap(d, di)).length === 0,
    );
    const expired = await preview(a, cid);
    const expiredId = String(body(expired).id);
    await admin.query(
      "UPDATE public.connection_previews SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [expiredId],
    );
    check('expired preview cannot send', (await send(a, expiredId)).status === 409);
    const changed = await preview(a, cid);
    const changedId = String(body(changed).id);
    await a.call(`/api/v1/memories/${mid}`, {
      method: 'PATCH',
      body: { expectedVersion: 2, content: '再次修改后的兴趣', allowedUses: ['sharing'] },
    });
    check('source version change requires new preview', (await send(a, changedId)).status === 409);
    const fresh = await preview(a, cid);
    const stale = await send(a, String(body(fresh).id));
    const staleId = String(body(stale).id);
    await a.call(`/api/v1/memories/${mid}`, {
      method: 'PATCH',
      body: { expectedVersion: 3, allowedUses: [] },
    });
    check(
      'tightening source policy blocks reads synchronously',
      items(await snap(c, staleId)).length === 0,
    );
    check('stale snapshot cannot be accepted', (await decision(c, staleId)).status === 409);
    check(
      'widget drops contents after source policy invalidation',
      (await c.connections.getWidget(staleId, c.options)).snapshot.items.length === 0,
    );
    await a.call(`/api/v1/memories/${mid}`, {
      method: 'PATCH',
      body: { expectedVersion: 4, allowedUses: ['sharing'] },
    });
    check(
      'restoring sharing never resurrects old snapshots',
      items(await snap(c, staleId)).length === 0,
    );
    await a.call(`${base}/invitations/${staleId}/revoke`, { method: 'POST' });
    const extraMemory = await memory(a);
    const multiPreview = await a.call(`${base}/previews`, {
      method: 'POST',
      body: { recipientUserId: cid, memoryItemIds: [mid, extraMemory] },
    });
    const multiSent = await send(a, String(body(multiPreview).id));
    const multiId = String(body(multiSent).id);
    await a.call(`/api/v1/memories/${extraMemory}`, {
      method: 'PATCH',
      body: { expectedVersion: 1, allowedUses: [] },
    });
    check(
      'a partially stale grant only returns its remaining authorized item',
      items(await snap(c, multiId)).length === 1,
    );
    check(
      'partial source invalidation requires a new confirmation',
      (await decision(c, multiId)).status === 409,
    );
    await a.call(`/api/v1/memories/${extraMemory}`, {
      method: 'PATCH',
      body: { expectedVersion: 2, allowedUses: ['sharing'] },
    });
    check('restored partial source stays invalidated', items(await snap(c, multiId)).length === 1);
    const deleted = await a.call(`/api/v1/memories/${mid}?expectedVersion=5`, { method: 'DELETE' });
    check(
      'soft deletion immediately removes the remaining shared item',
      deleted.status === 204 && items(await snap(c, multiId)).length === 0,
    );
    const cp = await preview(c, did, cmid),
      dp = await preview(d, cid, dmid);
    const opposite = await Promise.all([
      send(c, String(body(cp).id)),
      send(d, String(body(dp).id)),
    ]);
    check(
      'opposite-direction concurrent sends create only one invitation',
      opposite.filter((r) => r.status === 201).length === 1 &&
        opposite.filter((r) => r.status === 409).length === 1,
    );
    const own = await withRequestContext(pool, { userId: aid, principalId: aid }, (client) =>
      client.query('SELECT id FROM public.connection_invitations WHERE id=$1', [invite]),
    );
    const other = await withRequestContext(pool, { userId: cid, principalId: cid }, (client) =>
      client.query('SELECT id FROM public.connection_invitations WHERE id=$1', [invite]),
    );
    check(
      'RLS permits participant metadata and filters outsider',
      own.rowCount === 1 && other.rowCount === 0,
    );
    let privateDenied = false;
    try {
      await withRequestContext(pool, { userId: bid, principalId: bid }, (client) =>
        client.query('SELECT manifest FROM public.connection_previews'),
      );
    } catch {
      privateDenied = true;
    }
    check('raw preview values cannot be read through app pool', privateDenied);
    const sqlChecks = await admin.query<{ ok: boolean }>(`SELECT
      (SELECT count(*)=4 FROM pg_class WHERE oid IN ('public.connection_previews'::regclass,'public.connection_invitations'::regclass,'public.peer_connections'::regclass,'public.connection_events'::regclass) AND relforcerowsecurity AND relrowsecurity)
      AND NOT has_function_privilege('aven_worker','app.send_connection_invitation(uuid,uuid)','EXECUTE')
      AND NOT has_table_privilege('aven_app','public.connection_invitations','INSERT') AS ok`);
    check(
      'four tables FORCE RLS and runtime roles have no direct writes',
      sqlChecks.rows[0]?.ok === true,
    );
    const events = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.connection_events WHERE invitation_id=$1 AND event_type=$2',
      [invite, 'accepted'],
    );
    check('concurrent acceptance writes exactly one audit event', events.rows[0]?.count === '1');
    await a.connections.revoke(multiId, a.options);
    const elapsedMemory = await memory(c);
    const elapsedPreview = await c.connections.preview(
      { recipientUserId: aid, memoryItemIds: [elapsedMemory] },
      c.options,
    );
    const elapsedInvitation = await c.connections.send(elapsedPreview.id, randomUUID(), c.options);
    const deadline = Date.now() + 1500;
    const shorten = await c.call(`/api/v1/memories/${elapsedMemory}`, {
      method: 'PATCH',
      body: { expectedVersion: 1, validUntil: new Date(deadline).toISOString() },
    });
    if (shorten.status !== 200) throw new Error('Elapsed-source setup failed.');
    check(
      'future source deadline keeps the existing snapshot readable',
      (await a.connections.getSnapshot(elapsedInvitation.id, a.options)).items.length === 1,
    );
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now() + 30)));
    check(
      'elapsed source stops snapshot reads before maintenance',
      (await a.connections.getSnapshot(elapsedInvitation.id, a.options)).items.length === 0,
    );
    const extend = await c.call(`/api/v1/memories/${elapsedMemory}`, {
      method: 'PATCH',
      body: { expectedVersion: 2, validUntil: new Date(Date.now() + 7 * 86400000).toISOString() },
    });
    const afterExtension = await a.connections.getWidget(elapsedInvitation.id, a.options);
    check(
      'extending an elapsed source never resurrects an active grant snapshot',
      extend.status === 200 &&
        afterExtension.invitation.grantStatus === 'active' &&
        afterExtension.snapshot.items.length === 0,
    );
  } finally {
    await app.close();
    await pool.end();
    await admin.end();
  }
  if (failed) throw new Error(`${failed} connection verification checks failed.`);
  console.log('All personal connection verification checks passed.');
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Connection verification failed.');
  process.exitCode = 1;
});
