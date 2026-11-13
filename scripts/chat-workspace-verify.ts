import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createApiApplication } from '../apps/api/dist/app.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';

loadEnvFile('.env');
if (process.env.APP_ENV !== 'development')
  throw new Error('Development synthetic verification only.');
process.env.AUTH_IP_SALT = randomUUID();
process.env.AUTH_DEV_MODE = 'true';
process.env.AUTH_MAIL_TRANSPORT = 'file';
process.env.AUTH_MAIL_DIR = `.data/chat-workspace-mail-${randomUUID()}`;
const app = await createApiApplication(parseApiEnvironment(process.env), () => undefined);
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();
let checks = 0;
function check(ok: boolean, label: string) {
  if (!ok) throw new Error(label);
  checks++;
  console.log(`PASS ${label}`);
}
async function call(path: string, body?: unknown, token?: string, key?: string) {
  return fetch(`${base}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
}
async function account() {
  const email = `chat.${randomUUID()}@example.test`,
    password = randomUUID() + '!A7';
  check(
    (await call('auth/register', { email, password, displayName: '聊天工作区合成验证' })).status ===
      201,
    'synthetic account registered using local mail',
  );
  const login = await call('auth/login', { email, password, client: 'mobile' });
  check(login.status === 200, 'synthetic session signs in');
  return (await login.json()).sessionToken as string;
}
try {
  const owner = await account();
  const key = randomUUID();
  const input = { input: '帮我安排今天的学习' };
  const response = await call('agent/turns', input, owner, key);
  check(response.status === 201, 'chat turn accepted');
  const turn = await response.json();
  const duplicate = await call('agent/turns', input, owner, key);
  check(
    (await duplicate.json()).runId === turn.runId,
    'retry with the same key does not create another turn',
  );
  const stream = await call(`agent/runs/${turn.runId}/events`, undefined, owner);
  const frames = await stream.text();
  check(
    stream.status === 200 && frames.includes('turn.completed'),
    'real Worker completes and terminates SSE',
  );
  const events = frames
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)));
  const text = events
    .filter((event) => event.text)
    .map((event) => event.text)
    .join('');
  check(
    text.includes('Mock') && text.includes('1. **明确目标**'),
    'Worker returns the labelled structured planning example',
  );
  check(text.includes('不会创建日历'), 'reply does not claim an external action');
  const replay = await call(`agent/runs/${turn.runId}/events`, undefined, owner);
  check(
    (await replay.text()) === frames,
    'explicit replay returns the same authorized event sequence',
  );
  const other = await account();
  check(
    (await call(`agent/runs/${turn.runId}/events`, undefined, other)).status === 404,
    'another account cannot read the reply',
  );
  console.log(`${checks} checks passed. Real HTTP/DB/Worker/SSE; no external mail or model call.`);
} finally {
  await app.close();
}
