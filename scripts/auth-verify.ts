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
function readMail(kind: 'verify_email' | 'reset_password', email: string): string | undefined {
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
      const match = /(?:验证令牌|重置令牌|重置码)：(\S+)/.exec(message.text ?? '');
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
  const jar = new Map<string, string>();

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
      bearer?: string;
      useCookies?: boolean;
    } = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const headers = new Headers();
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.csrf) headers.set('x-csrf-token', options.csrf);
    if (options.bearer) headers.set('authorization', `Bearer ${options.bearer}`);
    if (options.useCookies !== false && jar.size) headers.set('cookie', cookieHeader());
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
    return { status: response.status, body, headers: response.headers };
  }

  const email = `auth.probe.${Date.now()}@example.test`;
  const password = 'Correct Horse Battery Staple 42!';
  const newPassword = 'New Correct Horse Battery 43!';
  const userIds: string[] = [];

  try {
    const register = await call('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, displayName: '认证测试用户' },
    });
    check('registration returns 201', register.status === 201, JSON.stringify(register.body));
    check(
      'registration requires email verification',
      nested(register.body, ['verificationRequired']) === true,
    );
    const userId = nested(register.body, ['user', 'id']);
    if (typeof userId === 'string') userIds.push(userId);

    const duplicate = await call('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, displayName: '认证测试用户' },
    });
    check('duplicate registration returns 409', duplicate.status === 409);
    check(
      'duplicate registration uses CONFLICT',
      nested(duplicate.body, ['error', 'code']) === 'CONFLICT',
    );

    const verificationToken = readMail('verify_email', email);
    check('development mail sink contains a verification token', Boolean(verificationToken));
    const verify = await call('/api/v1/auth/verify-email', {
      method: 'POST',
      body: { token: verificationToken },
    });
    check('email verification succeeds', verify.status === 200, JSON.stringify(verify.body));

    const wrongLogin = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: 'wrong password', client: 'web' },
    });
    check('wrong password returns 401', wrongLogin.status === 401);
    check(
      'wrong password uses UNAUTHENTICATED',
      nested(wrongLogin.body, ['error', 'code']) === 'UNAUTHENTICATED',
    );

    const login = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password, client: 'web' },
    });
    check('web login returns 200', login.status === 200, JSON.stringify(login.body));
    const csrf = nested(login.body, ['csrfToken']);
    check('web login returns a CSRF token', typeof csrf === 'string' && csrf.length > 20);
    check(
      'web login does not return the session token in the body',
      nested(login.body, ['sessionToken']) === undefined,
    );
    const setCookies = login.headers.getSetCookie();
    check(
      'session cookie is HttpOnly',
      setCookies.some((cookie) => cookie.startsWith('aven_session=') && /HttpOnly/i.test(cookie)),
    );
    check(
      'CSRF cookie is readable by the client',
      setCookies.some((cookie) => cookie.startsWith('aven_csrf=') && !/HttpOnly/i.test(cookie)),
    );

    const me = await call('/api/v1/auth/me');
    check('authenticated me returns 200', me.status === 200, JSON.stringify(me.body));
    check('me returns the registered email', nested(me.body, ['user', 'email']) === email);
    check('me reports verified email', nested(me.body, ['user', 'emailVerified']) === true);
    check('me marks the current session', nested(me.body, ['session', 'current']) === true);

    const sessions = await call('/api/v1/auth/sessions');
    check('session list returns 200', sessions.status === 200);
    check(
      'session list contains the current session',
      Array.isArray(nested(sessions.body, ['data'])) &&
        (nested(sessions.body, ['data']) as unknown[]).some(
          (item) => nested(item, ['current']) === true,
        ),
    );

    const csrfMissing = await call('/api/v1/auth/logout', { method: 'POST' });
    check('web logout without CSRF returns 403', csrfMissing.status === 403);
    check(
      'missing CSRF uses FORBIDDEN',
      nested(csrfMissing.body, ['error', 'code']) === 'FORBIDDEN',
    );

    const logout = await call('/api/v1/auth/logout', {
      method: 'POST',
      csrf: typeof csrf === 'string' ? csrf : undefined,
    });
    check('web logout with CSRF returns 204', logout.status === 204);
    const afterLogout = await call('/api/v1/auth/me');
    check('logged-out session is rejected', afterLogout.status === 401);

    const loginAgain = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password, client: 'web' },
    });
    const csrfAgain = nested(loginAgain.body, ['csrfToken']);
    const wrongChange = await call('/api/v1/auth/password/change', {
      method: 'POST',
      csrf: typeof csrfAgain === 'string' ? csrfAgain : undefined,
      body: { currentPassword: 'wrong password', newPassword },
    });
    check('password change with wrong current password returns 401', wrongChange.status === 401);
    const change = await call('/api/v1/auth/password/change', {
      method: 'POST',
      csrf: typeof csrfAgain === 'string' ? csrfAgain : undefined,
      body: { currentPassword: password, newPassword },
    });
    check('password change returns 204', change.status === 204);
    const afterChange = await call('/api/v1/auth/me');
    check('password change revokes the current session', afterChange.status === 401);

    clearRateLimits();
    const oldPassword = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password, client: 'web' },
    });
    check('old password is rejected after change', oldPassword.status === 401);
    const newLogin = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: newPassword, client: 'web' },
    });
    check('new password logs in', newLogin.status === 200);

    const resetRequest = await call('/api/v1/auth/password/reset-request', {
      method: 'POST',
      body: { email },
    });
    check('password reset request returns 202', resetRequest.status === 202);
    const resetToken = readMail('reset_password', email);
    check('development mail sink contains a reset token', Boolean(resetToken));
    const reset = await call('/api/v1/auth/password/reset', {
      method: 'POST',
      body: { token: resetToken, password },
    });
    check('password reset returns 204', reset.status === 204);
    const afterReset = await call('/api/v1/auth/me');
    check('password reset revokes existing sessions', afterReset.status === 401);
    clearRateLimits();
    const resetLogin = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password, client: 'web' },
    });
    check('reset password logs in', resetLogin.status === 200);

    clearRateLimits();
    const mobileLogin = await call('/api/v1/auth/login', {
      method: 'POST',
      useCookies: false,
      body: { email, password, client: 'mobile' },
    });
    check('mobile login returns 200', mobileLogin.status === 200);
    const mobileToken = nested(mobileLogin.body, ['sessionToken']);
    check('mobile login returns a bearer token', typeof mobileToken === 'string');
    check(
      'mobile login does not return a CSRF token',
      nested(mobileLogin.body, ['csrfToken']) === undefined,
    );
    const mobileMe = await call('/api/v1/auth/me', {
      useCookies: false,
      bearer: typeof mobileToken === 'string' ? mobileToken : undefined,
    });
    check('mobile bearer session reaches me', mobileMe.status === 200);

    const webLoginForRevoke = await call('/api/v1/auth/login', {
      method: 'POST',
      useCookies: false,
      body: { email, password, client: 'web' },
    });
    const webCsrf = nested(webLoginForRevoke.body, ['csrfToken']);
    const mobileSessionId = nested(mobileLogin.body, ['session', 'id']);
    const revoke = await call(`/api/v1/auth/sessions/${String(mobileSessionId)}/revoke`, {
      method: 'POST',
      useCookies: false,
      csrf: typeof webCsrf === 'string' ? webCsrf : undefined,
    });
    check('session revoke without a web session is rejected', revoke.status === 401);

    const webLoginWithCookies = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password, client: 'web' },
    });
    const webCsrf2 = nested(webLoginWithCookies.body, ['csrfToken']);
    const revokeWithCookies = await call(
      `/api/v1/auth/sessions/${String(mobileSessionId)}/revoke`,
      {
        method: 'POST',
        csrf: typeof webCsrf2 === 'string' ? webCsrf2 : undefined,
      },
    );
    check('session revoke returns 204', revokeWithCookies.status === 204);
    const revokedMobile = await call('/api/v1/auth/me', {
      useCookies: false,
      bearer: typeof mobileToken === 'string' ? mobileToken : undefined,
    });
    check('revoked mobile session is rejected', revokedMobile.status === 401);

    clearRateLimits();
    const rateEmail = `auth.rate.${Date.now()}@example.test`;
    const rateRegister = await call('/api/v1/auth/register', {
      method: 'POST',
      body: { email: rateEmail, password, displayName: '限流测试用户' },
    });
    const rateUserId = nested(rateRegister.body, ['user', 'id']);
    if (typeof rateUserId === 'string') userIds.push(rateUserId);
    let limited: { status: number; headers: Headers } | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      limited = await call('/api/v1/auth/login', {
        method: 'POST',
        body: { email: rateEmail, password: 'wrong password', client: 'web' },
      });
    }
    check('repeated login attempts are rate limited', limited?.status === 429);
    check('rate limit returns Retry-After', Number(limited?.headers.get('retry-after') ?? 0) > 0);
  } finally {
    const migrator = createPool('aven_migrator', { max: 2 });
    if (userIds.length) {
      await migrator
        .query('DELETE FROM public.principals WHERE id = ANY($1::uuid[])', [userIds])
        .catch(() => undefined);
    }
    await migrator.end().catch(() => undefined);
    await app.close();
  }

  if (failed) {
    console.error(`\n${failed} authentication check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll authentication checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Authentication check failed.');
  process.exitCode = 1;
});
