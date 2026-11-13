import { readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AuthService } from '../apps/api/dist/auth/auth.service.js';
import { MAILER } from '../apps/api/dist/auth/auth.constants.js';
import type { Mailer } from '../apps/api/src/auth/mailer.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';

loadEnvFile('.env');
if (process.env.APP_ENV !== 'development')
  throw new Error('Development synthetic verification only.');
process.env.AUTH_IP_SALT = randomUUID();
process.env.AUTH_DEV_MODE = 'true';
process.env.AUTH_MAIL_TRANSPORT = 'file';
process.env.AUTH_MAIL_DIR = `.data/registration-mail-${randomUUID()}`;
const env = parseApiEnvironment(process.env);
const app = await createApiApplication(env, () => undefined);
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();
const mailer = app.get<Mailer>(MAILER);
const send = mailer.send.bind(mailer);
const email = `registration.${randomUUID()}@example.test`;
const password = randomUUID() + '!A7';
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
  mailer.send = async () => {
    throw new Error('SIMULATED_MAIL_FAILURE');
  };
  const first = await post('register', { email, password, displayName: '原始合成资料' });
  const created = await first.json();
  check(
    first.status === 201 && created.verificationDelivery === 'failed',
    'mail failure preserves successful account creation',
  );
  mailer.send = send;
  const retry = await post('register', { email, password, displayName: '不应覆盖资料' });
  const resent = await retry.json();
  check(
    retry.status === 201 && resent.verificationDelivery === 'sent',
    'matching password permits unverified account resend',
  );
  check(
    resent.user.id === created.user.id && resent.user.displayName === '原始合成资料',
    'retry retains the original identity and profile',
  );
  const mailCount = readdirSync(env.AUTH_MAIL_DIR).length;
  const wrong = await post('register', {
    email,
    password: randomUUID() + '!Z8',
    displayName: '不可覆盖',
  });
  const conflict = await wrong.json();
  check(
    wrong.status === 409 && conflict.error.code === 'ACCOUNT_ALREADY_EXISTS',
    'wrong password returns explicit account conflict',
  );
  check(
    readdirSync(env.AUTH_MAIL_DIR).length === mailCount,
    'wrong password cannot send verification mail',
  );
  check(
    (await post('login', { email, password, client: 'mobile' })).status === 200,
    'original password remains usable',
  );
  let emailLimited = false;
  try {
    await app
      .get(AuthService)
      .register(
        { email, password, displayName: '限流' },
        { ip: '127.0.0.2', userAgent: 'isolated-registration-check' },
      );
  } catch (error) {
    emailLimited =
      error instanceof Error &&
      'getStatus' in error &&
      typeof error.getStatus === 'function' &&
      error.getStatus() === 429;
  }
  check(emailLimited, 'resend respects email rate limit even from a different IP');
  const verifiedEmail = `verified.${randomUUID()}@example.test`;
  const second = await post('register', {
    email: verifiedEmail,
    password,
    displayName: '已验证合成资料',
  });
  check(second.status === 201, 'second synthetic account is created');
  const message = readdirSync(env.AUTH_MAIL_DIR)
    .map((name) => JSON.parse(readFileSync(`${env.AUTH_MAIL_DIR}/${name}`, 'utf8')))
    .find((value) => value.to === verifiedEmail);
  const token = /验证令牌：([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
  check(
    (await post('verify-email', { token })).status === 200,
    'verification token verifies the account',
  );
  const verified = await post('register', {
    email: verifiedEmail,
    password,
    displayName: '不可覆盖',
  });
  check(
    verified.status === 409 && (await verified.json()).error.code === 'ACCOUNT_ALREADY_EXISTS',
    'verified accounts must use login or password recovery',
  );
  console.log(`${checks} checks passed. No external email or live rate-limit clearing.`);
} finally {
  mailer.send = send;
  await app.close();
}
