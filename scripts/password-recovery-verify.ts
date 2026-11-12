import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createApiApplication } from '../apps/api/dist/app.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';

loadEnvFile('.env');
if (process.env.APP_ENV !== 'development')
  throw new Error('Development synthetic verification only.');
// A unique salt isolates this test's IP rate-limit keys; never clear live keys.
process.env.AUTH_IP_SALT = randomUUID();
process.env.AUTH_DEV_MODE = 'true';
process.env.AUTH_MAIL_TRANSPORT = 'file';
process.env.AUTH_MAIL_DIR = `.data/recovery-mail-${randomUUID()}`;
const env = parseApiEnvironment(process.env);
const app = await createApiApplication(env, () => undefined);
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();
const email = `recovery.${randomUUID()}@example.test`;
const password = randomUUID() + '!A7';
const nextPassword = randomUUID() + '!B8';
let checks = 0;
function check(ok: boolean, label: string) {
  if (!ok) throw new Error(label);
  checks++;
  console.log(`PASS ${label}`);
}
async function post(path: string, body: unknown) {
  return fetch(`${base}/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
try {
  check(
    (await post('register', { email, password, displayName: '密码恢复合成验证' })).status === 201,
    'synthetic registration succeeds with the explicit local sink',
  );
  const login = await post('login', { email, password, client: 'mobile' });
  check(login.status === 200, 'old password creates a session');
  const old = (await login.json()) as { sessionToken: string };
  check(
    (await post('password/reset-request', { email })).status === 202,
    'recovery returns non-enumerating accepted status',
  );
  const files = readdirSync(env.AUTH_MAIL_DIR).filter((name) => name.endsWith('.json'));
  const messages = files.map(
    (name) =>
      JSON.parse(readFileSync(`${env.AUTH_MAIL_DIR}/${name}`, 'utf8')) as {
        kind: string;
        text: string;
      },
  );
  const message = messages.find((value) => value.kind === 'reset_password');
  if (!message) throw new Error('Missing synthetic reset message.');
  const match = /重置码：([A-Za-z0-9_-]+)/.exec(message.text);
  const token = match?.[1];
  if (!token) throw new Error('Missing reset token.');
  check(
    message.text.includes(`${env.WEB_ORIGIN}/#reset_token=${token}`),
    'message binds a fragment link to the configured AVEN origin',
  );
  check(!message.text.includes('?reset_token='), 'reset token is not placed in a query string');
  const absent = await post('password/reset-request', {
    email: `absent.${randomUUID()}@example.test`,
  });
  check(
    absent.status === 202 && ((await absent.json()) as { ok: boolean }).ok,
    'missing account gets the same response',
  );
  check(
    (await post('password/reset', { token, password: nextPassword })).status === 204,
    'valid link token resets the password',
  );
  check(
    (await post('password/reset', { token, password: nextPassword })).status === 422,
    'consumed reset token cannot be reused',
  );
  check(
    (
      await fetch(`${base}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${old.sessionToken}` },
      })
    ).status === 401,
    'reset revokes the old device session',
  );
  check(
    (await post('login', { email, password, client: 'mobile' })).status === 401,
    'old password is rejected',
  );
  const next = await post('login', { email, password: nextPassword, client: 'mobile' });
  check(next.status === 200, 'new password signs in');
  const session = (await next.json()) as { sessionToken: string };
  await fetch(`${base}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  mkdirSync('.data', { recursive: true });
  writeFileSync(
    '.data/recovery-verification-result.json',
    JSON.stringify({ checks, passed: true }),
    { mode: 0o600 },
  );
  console.log(`${checks} checks passed. No live rate-limit keys cleared or external mail sent.`);
} finally {
  await app.close();
}
