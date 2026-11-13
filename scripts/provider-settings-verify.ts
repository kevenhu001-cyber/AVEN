import { loadEnvFile } from 'node:process';
import { randomBytes, randomUUID } from 'node:crypto';
loadEnvFile('.env');
if (process.env.APP_ENV !== 'development')
  throw new Error('Isolated development verification only.');
Object.assign(process.env, {
  POSTGRES_DB: 'aven_test',
  AUTH_IP_SALT: randomUUID(),
  AUTH_DEV_MODE: 'true',
  AUTH_MAIL_TRANSPORT: 'file',
  AUTH_MAIL_DIR: `.data/provider-settings-mail-${randomUUID()}`,
  AI_PROVIDER: 'mock',
  AI_MODEL: 'mock-deterministic-v1',
  AI_USER_ALLOWED_BASE_URLS: 'public_https',
  AI_USER_CONFIG_KEY: randomBytes(32).toString('base64'),
});
delete process.env.DATABASE_URL;
const { createApiApplication } = await import('../apps/api/dist/app.js');
const { parseApiEnvironment } = await import('../packages/config/dist/env.js');
const { createPool, createApplicationPool } = await import('../packages/database/dist/index.js');
const { MockProvider, decryptProviderKey } = await import('../packages/ai-core/dist/index.js');
const { userProviderForRun } = await import('../apps/worker/dist/user-provider.js');
const { authorizeExternalRun } = await import('../apps/worker/dist/external-preflight.js');
const { processAgentRun } = await import('../apps/worker/dist/agent.js');
const app = await createApiApplication(parseApiEnvironment(process.env), () => undefined);
await app.listen(0, '127.0.0.1');
const base = await app.getUrl(),
  worker = createPool('aven_worker'),
  reader = createApplicationPool();
let checks = 0;
function check(ok: boolean, label: string) {
  if (!ok) throw new Error(label);
  checks++;
  console.log(`PASS ${label}`);
}
async function call(
  path: string,
  token?: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) {
  return fetch(`${base}/api/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Idempotency-Key': randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function account() {
  const email = `provider.${randomUUID()}@example.test`,
    password = randomUUID() + '!A7';
  const signup = await call('auth/register', undefined, {
    email,
    password,
    displayName: '渠道合成验证',
  });
  if (signup.status !== 201) throw new Error('SIGNUP_FAILED');
  const result = await call('auth/login', undefined, { email, password, client: 'mobile' });
  return (await result.json()).sessionToken as string;
}
async function turn(token: string) {
  const result = await call('agent/turns', token, { input: '这是合成渠道测试' });
  check(result.status === 201, 'personal turn is accepted');
  return (await result.json()).runId as string;
}
const draft = {
  baseUrl: 'https://channel.example.org/v1',
  model: 'configured-model',
  apiKey: 'synthetic-channel-secret',
  expectedVersion: 0,
  expectedConfigId: null,
};
try {
  const a = await account(),
    b = await account();
  check((await call('agent/provider')).status === 401, 'configuration is authenticated');
  const response = await call('agent/provider', a, draft, 'PUT');
  check(response.status === 200, 'personal configuration can be saved');
  const saved = (await response.json()).data;
  check(
    Boolean(saved.configId) && !JSON.stringify(saved).includes('secret'),
    'metadata has immutable identity and no key',
  );
  check(
    (await (await call('agent/provider', b)).json()).data === null,
    'other account cannot read configuration',
  );
  const runtime = await (await call('agent/runtime', a)).json();
  check(runtime.providerMode === 'live', 'personal configuration overrides the default Mock mode');
  const old = await turn(a);
  const secret = (await worker.query('SELECT * FROM app.get_agent_run_user_provider($1)', [old]))
    .rows[0];
  check(
    Boolean(secret) && !secret.encrypted_key.includes(draft.apiKey),
    'Worker receives only encrypted run-bound credentials',
  );
  check(
    decryptProviderKey(secret.encrypted_key, secret.user_id, process.env.AI_USER_CONFIG_KEY) ===
      draft.apiKey,
    'run owner can be authenticated during decryption',
  );
  const selected = await userProviderForRun(worker, old);
  check(
    selected.metadata.model === draft.model && !selected.metadata.mock,
    'Worker resolves the configured personal model',
  );
  const edit = {
    baseUrl: draft.baseUrl,
    model: draft.model,
    expectedVersion: 1,
    expectedConfigId: saved.configId,
  };
  check(
    (await call('agent/provider', a, edit, 'PUT')).status === 200,
    'editing without a key retains the existing encrypted key',
  );
  check(
    (await worker.query('SELECT * FROM app.get_agent_run_user_provider($1)', [old])).rows.length ===
      0,
    'editing invalidates an older queued provider snapshot',
  );
  check(
    (await call('agent/provider', a, edit, 'PUT')).status === 409,
    'stale optimistic edits are rejected',
  );
  const current = (await (await call('agent/provider', a)).json()).data;
  check(
    (
      await call(
        `agent/provider?version=${current.version}&configId=${current.configId}`,
        a,
        undefined,
        'DELETE',
      )
    ).status === 200,
    'personal channel can be deleted by version and identity',
  );
  const recreated = (await (await call('agent/provider', a, draft, 'PUT')).json()).data;
  check(
    recreated.version === 1 && recreated.configId !== saved.configId,
    'delete and recreate has a new immutable identity',
  );
  check(
    (await worker.query('SELECT * FROM app.get_agent_run_user_provider($1)', [old])).rows.length ===
      0,
    'an ABA recreation cannot redirect an old run',
  );
  check(
    (await call(`agent/provider?version=1&configId=${saved.configId}`, a, undefined, 'DELETE'))
      .status === 409,
    'an old delete cannot remove the recreated channel',
  );
  for (const url of ['https://127.0.0.1/v1', 'https://service.internal/v1'])
    check(
      (await call('agent/provider/test', a, { ...draft, baseUrl: url })).status === 422,
      'connection test rejects a private endpoint before network access',
    );
  const next = await turn(a);
  class Capture extends MockProvider {
    override readonly metadata = {
      provider: 'openai_compatible' as const,
      model: draft.model,
      mock: false,
    };
  }
  const result = await processAgentRun(worker, next, new MockProvider(), () => undefined, {
    userProvider: async (runId) => {
      const actual = await userProviderForRun(worker, runId);
      check(actual.metadata.model === draft.model, 'execution selects the personal model');
      return new Capture();
    },
    authorizeExternal: (identity) => authorizeExternalRun(reader, identity),
  });
  check(
    result === 'completed',
    'personal run completes through the selected-provider path with a test stand-in',
  );
  check((await call(`agent/runs/${next}`, b)).status === 404, 'personal run remains isolated');
  await call(`agent/provider?version=1&configId=${recreated.configId}`, a, undefined, 'DELETE');
  check(
    (await (await call('agent/runtime', a)).json()).providerMode === 'mock',
    'deletion restores the actual default mode',
  );
  console.log(
    `${checks} checks passed on aven_test. No external model or mail requests; completion uses an explicit test stand-in.`,
  );
} finally {
  await app.close();
  await worker.end();
  await reader.end();
}
