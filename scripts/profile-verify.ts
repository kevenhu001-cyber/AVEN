import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AppModule } from '../apps/api/dist/app.module.js';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
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

async function main(): Promise<void> {
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
  const jar = new Map<string, string>();
  const migrator = createPool('aven_migrator', { max: 2 });
  const userIds: string[] = [];

  function cookieHeader(): string {
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  function updateCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index);
      const value = decodeURIComponent(pair.slice(index + 1));
      if (/Max-Age=0/i.test(raw)) jar.delete(name);
      else jar.set(name, value);
    }
  }
  async function call(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      csrf?: string;
    } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers = new Headers();
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.csrf) headers.set('x-csrf-token', options.csrf);
    if (jar.size) headers.set('cookie', cookieHeader());
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
    });
    updateCookies(response);
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

  const email = `profile.probe.${Date.now()}@example.test`;
  const password = 'Correct Horse Battery Staple 42!';

  try {
    const register = await call('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, displayName: '资料测试用户' },
    });
    const userId = nested(register.body, ['user', 'id']);
    if (typeof userId === 'string') userIds.push(userId);
    check('profile test user registers', register.status === 201, JSON.stringify(register.body));
    const token = readVerificationToken(email);
    await call('/api/v1/auth/verify-email', {
      method: 'POST',
      body: { token },
    });
    const login = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password, client: 'web' },
    });
    check('profile test user logs in', login.status === 200, JSON.stringify(login.body));
    const csrf = nested(login.body, ['csrfToken']);
    const beforeVersion = await migrator.query<{ version: number }>(
      'SELECT version FROM public.principals WHERE id = $1',
      [userId],
    );

    const update = await call('/api/v1/me', {
      method: 'PATCH',
      csrf: typeof csrf === 'string' ? csrf : undefined,
      body: {
        displayName: '资料测试用户（更新）',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
    });
    check('profile update returns 200', update.status === 200, JSON.stringify(update.body));
    check(
      'profile update returns the new display name',
      nested(update.body, ['user', 'displayName']) === '资料测试用户（更新）',
    );
    const afterVersion = await migrator.query<{ version: number }>(
      'SELECT version FROM public.principals WHERE id = $1',
      [userId],
    );
    check(
      'profile update increments the principal version',
      (afterVersion.rows[0]?.version ?? 0) > (beforeVersion.rows[0]?.version ?? 0),
    );

    const me = await call('/api/v1/auth/me');
    check(
      'me reflects the updated profile',
      nested(me.body, ['user', 'displayName']) === '资料测试用户（更新）',
    );

    const campuses = await call('/api/v1/campuses');
    check('campus list returns 200', campuses.status === 200);
    const campusData = nested(campuses.body, ['data']);
    check(
      'campus list includes the seeded campus',
      Array.isArray(campusData) && campusData.length === 1,
    );
    const campusId = Array.isArray(campusData) ? nested(campusData[0], ['id']) : undefined;

    const emptyMemberships = await call('/api/v1/me/campus-memberships');
    check(
      'new user has no campus memberships',
      emptyMemberships.status === 200 &&
        Array.isArray(nested(emptyMemberships.body, ['data'])) &&
        (nested(emptyMemberships.body, ['data']) as unknown[]).length === 0,
    );

    const requestMembership = await call('/api/v1/me/campus-memberships', {
      method: 'POST',
      csrf: typeof csrf === 'string' ? csrf : undefined,
      body: { campusId },
    });
    check(
      'campus membership request returns pending',
      requestMembership.status === 200 && nested(requestMembership.body, ['status']) === 'pending',
      JSON.stringify(requestMembership.body),
    );
    const membershipId = nested(requestMembership.body, ['id']);
    const repeated = await call('/api/v1/me/campus-memberships', {
      method: 'POST',
      csrf: typeof csrf === 'string' ? csrf : undefined,
      body: { campusId },
    });
    check(
      'campus membership request is idempotent',
      repeated.status === 200 && nested(repeated.body, ['id']) === membershipId,
    );

    const memberships = await call('/api/v1/me/campus-memberships');
    check(
      'campus membership list contains the pending request',
      memberships.status === 200 &&
        Array.isArray(nested(memberships.body, ['data'])) &&
        (nested(memberships.body, ['data']) as unknown[]).length === 1,
    );

    const missingCsrf = await call('/api/v1/me', {
      method: 'PATCH',
      body: { displayName: 'no csrf' },
    });
    check('profile update without CSRF returns 403', missingCsrf.status === 403);

    const invalidTimezone = await call('/api/v1/me', {
      method: 'PATCH',
      csrf: typeof csrf === 'string' ? csrf : undefined,
      body: { timezone: 'Not/A_Timezone' },
    });
    check('invalid timezone returns 422', invalidTimezone.status === 422);

    const invalidName = await call('/api/v1/me', {
      method: 'PATCH',
      csrf: typeof csrf === 'string' ? csrf : undefined,
      body: { displayName: '   ' },
    });
    check('empty display name returns 422', invalidName.status === 422);

    const unknownCampus = await call('/api/v1/me/campus-memberships', {
      method: 'POST',
      csrf: typeof csrf === 'string' ? csrf : undefined,
      body: { campusId: '00000000-0000-4000-8000-000000000000' },
    });
    check('unknown campus returns 422', unknownCampus.status === 422);
  } finally {
    if (userIds.length) {
      await migrator
        .query('DELETE FROM public.campus_memberships WHERE user_id = ANY($1::uuid[])', [userIds])
        .catch(() => undefined);
      await migrator
        .query('DELETE FROM public.principals WHERE id = ANY($1::uuid[])', [userIds])
        .catch(() => undefined);
    }
    await migrator.end().catch(() => undefined);
    await app.close();
  }

  if (failed) {
    console.error(`\n${failed} profile/campus check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll profile and campus checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Profile/campus check failed.');
  process.exitCode = 1;
});
