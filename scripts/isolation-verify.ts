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
function readMail(kind: 'verify_email' | 'invite_organization', email: string): string | undefined {
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
      if (message.to !== email || message.kind !== kind) continue;
      const match = /(?:验证令牌|邀请令牌)：(\S+)/.exec(message.text ?? '');
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
    const token = readMail('verify_email', email);
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
  const organizationIds: string[] = [];
  const stamp = Date.now();
  const password = 'Correct Horse Battery Staple 42!';
  const emailA = `iso.a.${stamp}@example.test`;
  const emailB = `iso.b.${stamp}@example.test`;
  const emailC = `iso.c.${stamp}@example.test`;
  const emailD = `iso.d.${stamp}@example.test`;
  const clientA = new Client(baseUrl);
  const clientB = new Client(baseUrl);
  const clientC = new Client(baseUrl);

  try {
    const userA = await clientA.register(emailA, '隔离用户 A', password);
    const userB = await clientB.register(emailB, '隔离用户 B', password);
    const userC = await clientC.register(emailC, '隔离用户 C', password);
    userIds.push(userA, userB, userC);
    check('isolation users register and log in', Boolean(userA && userB && userC));

    const campuses = await clientA.call('/api/v1/campuses');
    const campusId = Array.isArray(nested(campuses.body, ['data']))
      ? nested((nested(campuses.body, ['data']) as unknown[])[0], ['id'])
      : undefined;

    const orgOne = await clientA.call('/api/v1/organizations', {
      method: 'POST',
      body: { name: '隔离实验室一', slug: `iso-lab-one-${stamp}`, type: 'lab', campusId },
    });
    const orgTwo = await clientC.call('/api/v1/organizations', {
      method: 'POST',
      body: { name: '隔离实验室二', slug: `iso-lab-two-${stamp}`, type: 'lab', campusId },
    });
    const orgOneId = nested(orgOne.body, ['id']);
    const orgTwoId = nested(orgTwo.body, ['id']);
    if (typeof orgOneId === 'string') organizationIds.push(orgOneId);
    if (typeof orgTwoId === 'string') organizationIds.push(orgTwoId);
    check('two organizations are created', orgOne.status === 201 && orgTwo.status === 201);

    const inviteB = await clientA.call(`/api/v1/organizations/${String(orgOneId)}/invitations`, {
      method: 'POST',
      body: { email: emailB, role: 'member' },
    });
    const inviteTokenB = readMail('invite_organization', emailB);
    const acceptB = await clientB.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteTokenB },
    });
    check('user B joins organization one', inviteB.status === 201 && acceptB.status === 200);

    const bReadsOne = await clientB.call(`/api/v1/organizations/${String(orgOneId)}`);
    const bReadsTwo = await clientB.call(`/api/v1/organizations/${String(orgTwoId)}`);
    check('same-organization member can read organization one', bReadsOne.status === 200);
    check('cross-organization member cannot read organization two', bReadsTwo.status === 404);

    const cReadsOne = await clientC.call(`/api/v1/organizations/${String(orgOneId)}`);
    const cReadsTwo = await clientC.call(`/api/v1/organizations/${String(orgTwoId)}`);
    check('organization two owner cannot read organization one', cReadsOne.status === 404);
    check('organization two owner can read organization two', cReadsTwo.status === 200);

    const bInvites = await clientB.call(`/api/v1/organizations/${String(orgOneId)}/invitations`, {
      method: 'POST',
      body: { email: emailD, role: 'member' },
    });
    check('plain member cannot invite', bInvites.status === 403);
    const bChangesOwner = await clientB.call(
      `/api/v1/organizations/${String(orgOneId)}/members/${String(userA)}`,
      { method: 'PATCH', body: { role: 'member' } },
    );
    check('plain member cannot change owner role', bChangesOwner.status === 403);
    const bRemovesOwner = await clientB.call(
      `/api/v1/organizations/${String(orgOneId)}/members/${String(userA)}`,
      { method: 'DELETE' },
    );
    check('plain member cannot remove owner', bRemovesOwner.status === 403);
    const cInvitesOne = await clientC.call(
      `/api/v1/organizations/${String(orgOneId)}/invitations`,
      { method: 'POST', body: { email: emailD, role: 'member' } },
    );
    check(
      'cross-organization owner cannot invite into organization one',
      cInvitesOne.status === 403,
    );

    const forgedHeaders = await clientA.call('/api/v1/organizations', {
      headers: { 'x-user-id': String(userC), 'x-principal-id': String(userC) },
    });
    const forgedData = nested(forgedHeaders.body, ['data']);
    check(
      'client-supplied user/principal headers are ignored',
      Array.isArray(forgedData) &&
        forgedData.length === 1 &&
        nested(forgedData[0], ['id']) === orgOneId,
    );

    const inviteD = await clientA.call(`/api/v1/organizations/${String(orgOneId)}/invitations`, {
      method: 'POST',
      body: { email: emailD, role: 'member' },
    });
    const inviteTokenD = readMail('invite_organization', emailD);
    const mismatch = await clientB.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteTokenD },
    });
    check(
      'invitation token cannot be accepted by a different email',
      inviteD.status === 201 && mismatch.status === 422,
    );

    const removeB = await clientA.call(
      `/api/v1/organizations/${String(orgOneId)}/members/${String(userB)}`,
      { method: 'DELETE' },
    );
    check('owner removes member B', removeB.status === 204);
    const bAfterRemoval = await clientB.call(`/api/v1/organizations/${String(orgOneId)}`);
    const bMembersAfterRemoval = await clientB.call(
      `/api/v1/organizations/${String(orgOneId)}/members`,
    );
    check('removed member cannot read organization detail', bAfterRemoval.status === 404);
    check('removed member cannot read member list', bMembersAfterRemoval.status === 404);

    const aMemberships = await withRequestContext(
      appPool,
      { principalId: userA, userId: userA },
      async (client) =>
        client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM public.organization_memberships WHERE status = 'active'",
        ),
    );
    const cMemberships = await withRequestContext(
      appPool,
      { principalId: userC, userId: userC },
      async (client) =>
        client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM public.organization_memberships WHERE status = 'active'",
        ),
    );
    const noContextMemberships = await appPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.organization_memberships WHERE status = 'active'",
    );
    check(
      'pooled context A sees only its organization membership',
      aMemberships.rows[0]?.count === '1',
    );
    check(
      'pooled context C sees only its organization membership',
      cMemberships.rows[0]?.count === '1',
    );
    check(
      'pooled connection does not retain a previous context',
      noContextMemberships.rows[0]?.count === '0',
    );
    const residualContext = await appPool.query<{ value: string | null }>(
      "SELECT nullif(current_setting('app.user_id', true), '') AS value",
    );
    check(
      'transaction-local user context is cleared after commit',
      residualContext.rows[0]?.value === null,
    );

    const forgedPrincipal = await withRequestContext(
      appPool,
      { principalId: userA, userId: userC },
      async (client) =>
        client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM public.principals WHERE id = '${userC}'`,
        ),
    );
    check(
      'mismatched principal/user context cannot read the other principal',
      forgedPrincipal.rows[0]?.count === '0',
    );
  } finally {
    for (const organizationId of organizationIds) {
      await migrator
        .query('DELETE FROM public.principals WHERE id = $1', [organizationId])
        .catch(() => undefined);
    }
    if (userIds.length) {
      await migrator
        .query('DELETE FROM public.principals WHERE id = ANY($1::uuid[])', [userIds])
        .catch(() => undefined);
    }
    await appPool.end().catch(() => undefined);
    await migrator.end().catch(() => undefined);
    await app.close();
  }

  if (failed) {
    console.error(`\n${failed} isolation check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll isolation checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Isolation check failed.');
  process.exitCode = 1;
});
