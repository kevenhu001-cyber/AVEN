import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';
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
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const stamp = Date.now();
  const password = 'Correct Horse Battery Staple 42!';
  const emailA = `org.a.${stamp}@example.test`;
  const emailB = `org.b.${stamp}@example.test`;
  const emailC = `org.c.${stamp}@example.test`;
  const emailD = `org.d.${stamp}@example.test`;
  const clientA = new Client(baseUrl);
  const clientB = new Client(baseUrl);
  const clientC = new Client(baseUrl);

  try {
    const userA = await clientA.register(emailA, '组织创建者', password);
    const userB = await clientB.register(emailB, '组织管理员', password);
    const userC = await clientC.register(emailC, '组织成员', password);
    userIds.push(userA, userB, userC);
    check('three organization test users register and log in', Boolean(userA && userB && userC));

    const campuses = await clientA.call('/api/v1/campuses');
    const campusId = Array.isArray(nested(campuses.body, ['data']))
      ? nested((nested(campuses.body, ['data']) as unknown[])[0], ['id'])
      : undefined;

    const slug = `verify-lab-${stamp}`;
    const created = await clientA.call('/api/v1/organizations', {
      method: 'POST',
      body: {
        name: '验证实验室',
        slug,
        description: '仅用于组织成员验证的样例。',
        type: 'lab',
        campusId,
      },
    });
    check(
      'organization creation returns 201',
      created.status === 201,
      JSON.stringify(created.body),
    );
    const organizationId = nested(created.body, ['id']);
    if (typeof organizationId === 'string') organizationIds.push(organizationId);
    check('creator is owner', nested(created.body, ['role']) === 'owner');
    check('creator member count is one', nested(created.body, ['memberCount']) === 1);

    const listA = await clientA.call('/api/v1/organizations');
    check(
      'owner lists the organization',
      Array.isArray(nested(listA.body, ['data'])) &&
        (nested(listA.body, ['data']) as unknown[]).length === 1,
    );
    const listB = await clientB.call('/api/v1/organizations');
    check(
      'non-member lists no organization',
      Array.isArray(nested(listB.body, ['data'])) &&
        (nested(listB.body, ['data']) as unknown[]).length === 0,
    );
    const detailB = await clientB.call(`/api/v1/organizations/${String(organizationId)}`);
    check('non-member cannot read organization detail', detailB.status === 404);

    const inviteB = await clientA.call(
      `/api/v1/organizations/${String(organizationId)}/invitations`,
      {
        method: 'POST',
        body: { email: emailB, role: 'admin' },
      },
    );
    check('owner invites an admin', inviteB.status === 201, JSON.stringify(inviteB.body));
    const inviteTokenB = readMail('invite_organization', emailB);
    check('invitation mail sink contains a token', Boolean(inviteTokenB));
    const acceptB = await clientB.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteTokenB },
    });
    check('invitee accepts the invitation', acceptB.status === 200, JSON.stringify(acceptB.body));
    check('accepted role is admin', nested(acceptB.body, ['role']) === 'admin');

    const inviteC = await clientB.call(
      `/api/v1/organizations/${String(organizationId)}/invitations`,
      {
        method: 'POST',
        body: { email: emailC, role: 'member' },
      },
    );
    check('admin invites a member', inviteC.status === 201, JSON.stringify(inviteC.body));
    const inviteTokenC = readMail('invite_organization', emailC);
    const acceptC = await clientC.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteTokenC },
    });
    check('member accepts the invitation', acceptC.status === 200);

    const members = await clientA.call(`/api/v1/organizations/${String(organizationId)}/members`);
    check(
      'organization has three active members',
      Array.isArray(nested(members.body, ['data'])) &&
        (nested(members.body, ['data']) as unknown[]).length === 3,
    );
    const detailA = await clientA.call(`/api/v1/organizations/${String(organizationId)}`);
    check('organization detail reports three members', nested(detailA.body, ['memberCount']) === 3);

    const adminChangesOwner = await clientB.call(
      `/api/v1/organizations/${String(organizationId)}/members/${String(userA)}`,
      { method: 'PATCH', body: { role: 'member' } },
    );
    check('admin cannot change the owner role', adminChangesOwner.status === 403);
    const adminRemovesOwner = await clientB.call(
      `/api/v1/organizations/${String(organizationId)}/members/${String(userA)}`,
      { method: 'DELETE' },
    );
    check('admin cannot remove the owner', adminRemovesOwner.status === 409);

    const ownerChangesAdmin = await clientA.call(
      `/api/v1/organizations/${String(organizationId)}/members/${String(userB)}`,
      { method: 'PATCH', body: { role: 'member' } },
    );
    check('owner changes admin to member', ownerChangesAdmin.status === 204);
    const listBAfterDemotion = await clientB.call('/api/v1/organizations');
    check(
      'demoted member sees the member role',
      nested((nested(listBAfterDemotion.body, ['data']) as unknown[])[0], ['role']) === 'member',
    );

    const memberInvites = await clientB.call(
      `/api/v1/organizations/${String(organizationId)}/invitations`,
      { method: 'POST', body: { email: emailD, role: 'member' } },
    );
    check('plain member cannot invite', memberInvites.status === 403);

    const removeB = await clientA.call(
      `/api/v1/organizations/${String(organizationId)}/members/${String(userB)}`,
      { method: 'DELETE' },
    );
    check('owner removes a member', removeB.status === 204);
    const listBAfterRemoval = await clientB.call('/api/v1/organizations');
    check(
      'removed member lists no organization',
      Array.isArray(nested(listBAfterRemoval.body, ['data'])) &&
        (nested(listBAfterRemoval.body, ['data']) as unknown[]).length === 0,
    );

    const lastOwnerLeave = await clientA.call(
      `/api/v1/organizations/${String(organizationId)}/leave`,
      { method: 'POST' },
    );
    check('last owner cannot leave', lastOwnerLeave.status === 409);

    const inviteD = await clientA.call(
      `/api/v1/organizations/${String(organizationId)}/invitations`,
      { method: 'POST', body: { email: emailD, role: 'member' } },
    );
    check('owner invites a new email', inviteD.status === 201);
    const inviteTokenD = readMail('invite_organization', emailD);
    const mismatch = await clientB.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteTokenD },
    });
    check('invitation email mismatch is rejected', mismatch.status === 422);
    const invalidToken = await clientB.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: 'a'.repeat(43) },
    });
    check('invalid invitation token is rejected', invalidToken.status === 422);

    const inviteBAgain = await clientA.call(
      `/api/v1/organizations/${String(organizationId)}/invitations`,
      { method: 'POST', body: { email: emailB, role: 'member' } },
    );
    check('owner re-invites removed member', inviteBAgain.status === 201);
    const inviteTokenBAgain = readMail('invite_organization', emailB);
    const acceptBAgain = await clientB.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteTokenBAgain },
    });
    check(
      'removed member can rejoin',
      acceptBAgain.status === 200,
      JSON.stringify(acceptBAgain.body),
    );
    const leaveB = await clientB.call(`/api/v1/organizations/${String(organizationId)}/leave`, {
      method: 'POST',
    });
    check('non-owner member can leave', leaveB.status === 204, JSON.stringify(leaveB.body));

    const duplicateSlug = await clientB.call('/api/v1/organizations', {
      method: 'POST',
      body: { name: '重复实验室', slug, type: 'lab' },
    });
    check('duplicate slug returns 409', duplicateSlug.status === 409);

    const missingCsrf = await clientA.call('/api/v1/organizations', {
      method: 'POST',
      csrf: false,
      body: { name: '无 CSRF 组织', slug: `no-csrf-${stamp}`, type: 'lab' },
    });
    check('organization creation without CSRF returns 403', missingCsrf.status === 403);
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
    await migrator.end().catch(() => undefined);
    await app.close();
  }

  if (failed) {
    console.error(`\n${failed} organization check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll organization checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Organization check failed.');
  process.exitCode = 1;
});
