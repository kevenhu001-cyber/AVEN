import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createApiApplication } from '../apps/api/dist/app.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApplicationPool, createPool } from '../packages/database/dist/index.js';
import {
  MockProvider,
  type AIMessage,
  type StreamTextInput,
} from '../packages/ai-core/dist/index.js';
import { processAgentRun } from '../apps/worker/dist/agent.js';
import { authorizeExternalRun } from '../apps/worker/dist/external-preflight.js';

loadEnvFile('.env');
if (process.env.APP_ENV !== 'development')
  throw new Error('Development verification only. Stop the shared Worker while this runs.');
Object.assign(process.env, {
  AUTH_DEV_MODE: 'true',
  AUTH_IP_SALT: randomUUID(),
  AUTH_MAIL_TRANSPORT: 'file',
  AUTH_MAIL_DIR: `.data/live-boundary-mail-${randomUUID()}`,
  AI_PROVIDER: 'openai_compatible',
  AI_BASE_URL: 'https://unused.example.test/v1',
  AI_API_KEY: 'unused-synthetic-key',
  AI_MODEL: 'boundary-test-model',
});
const app = await createApiApplication(parseApiEnvironment(process.env), () => undefined);
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();
const workerPool = createPool('aven_worker', { max: 2 });
const appPool = createApplicationPool({ max: 2 });
class CaptureProvider extends MockProvider {
  override readonly metadata = {
    provider: 'openai_compatible' as const,
    model: 'boundary-test-model',
    mock: false,
  };
  calls: AIMessage[][] = [];
  override async *streamText(input: StreamTextInput) {
    this.calls.push(input.messages);
    yield { type: 'text_delta' as const, text: '合成边界验证回复，不是真实模型输出。' };
    yield {
      type: 'done' as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop' as const,
    };
  }
}
const provider = new CaptureProvider();
let checks = 0;
function check(ok: boolean, label: string) {
  if (!ok) throw new Error(label);
  checks++;
  console.log(`PASS ${label}`);
}
async function call(path: string, method = 'GET', body?: unknown, token?: string) {
  return fetch(`${base}/api/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Idempotency-Key': randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function account() {
  const email = `boundary.${randomUUID()}@example.test`,
    password = randomUUID() + '!A7';
  const registration = await call('auth/register', 'POST', {
    email,
    password,
    displayName: '合成边界验证',
  });
  if (registration.status !== 201) throw new Error('SYNTHETIC_REGISTRATION_FAILED');
  const login = await call('auth/login', 'POST', { email, password, client: 'mobile' });
  return (await login.json()).sessionToken as string;
}
async function memory(token: string, content: string, allowed: boolean) {
  const response = await call(
    'memories',
    'POST',
    {
      kind: 'skill',
      title: '机器人学习',
      content,
      sensitivity: 'normal',
      displayAudience: 'owner',
      discoverable: false,
      allowedUses: allowed ? ['self_ai'] : [],
    },
    token,
  );
  if (response.status !== 201) throw new Error('SYNTHETIC_MEMORY_FAILED');
  return (await response.json()) as { id: string; version: number };
}
async function turn(token: string) {
  const response = await call('agent/turns', 'POST', { input: '请讨论机器人学习' }, token);
  if (response.status !== 201) throw new Error('SYNTHETIC_TURN_FAILED');
  return (await response.json()) as { runId: string };
}
try {
  const owner = await account(),
    other = await account();
  const allowed = await memory(owner, '机器人学习 allowed-synthetic-marker', true);
  await memory(owner, '机器人学习 denied-synthetic-marker', false);
  await memory(other, '机器人学习 other-user-marker', true);
  check((await call('agent/runtime')).status === 401, 'runtime metadata requires authentication');
  const metadata = await (await call('agent/runtime', 'GET', undefined, owner)).json();
  check(
    metadata.providerMode === 'live' && !('apiKey' in metadata),
    'metadata reports configured live mode without secrets',
  );
  const first = await turn(owner);
  const result = await processAgentRun(workerPool, first.runId, provider, () => undefined, {
    authorizeExternal: (identity) => authorizeExternalRun(appPool, identity),
  });
  check(
    result === 'completed' && provider.calls.length === 1,
    'authorized personal run reaches the capture provider',
  );
  const sent = JSON.stringify(provider.calls[0]);
  check(
    sent.includes('请讨论机器人学习') && sent.includes('allowed-synthetic-marker'),
    'only the current question and permitted matching memory are supplied',
  );
  check(!sent.includes('denied-synthetic-marker'), 'memory without self_ai permission stays out');
  check(!sent.includes('other-user-marker'), 'another user memory stays out');
  check(
    (await call(`agent/runs/${first.runId}/events`, 'GET', undefined, other)).status === 404,
    'another user cannot replay the result',
  );
  const second = await turn(owner);
  const revoked = await processAgentRun(workerPool, second.runId, provider, () => undefined, {
    authorizeExternal: async (identity) => {
      const response = await call(
        `memories/${allowed.id}`,
        'PATCH',
        { expectedVersion: allowed.version, allowedUses: [] },
        owner,
      );
      check(response.status === 200, 'permission can be revoked between retrieval and dispatch');
      return authorizeExternalRun(appPool, identity);
    },
  });
  check(
    revoked === 'failed' && provider.calls.length === 1,
    'preflight blocks external dispatch after revocation',
  );
  console.log(
    `${checks} checks passed using a capture stand-in, not a live model. No external requests or mail.`,
  );
} finally {
  await app.close();
  await workerPool.end();
  await appPool.end();
}
