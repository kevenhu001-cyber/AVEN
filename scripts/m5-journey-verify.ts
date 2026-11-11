import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplicationPool, withRequestContext } from '../packages/database/dist/index.js';
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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
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
  const baseUrl = `http://127.0.0.1:${port}`;

  const client1 = new Client(baseUrl); // Applicant
  const client2 = new Client(baseUrl); // Organization Owner
  const pool = createApplicationPool();

  try {
    const runId = randomUUID().slice(0, 8);
    const password = 'StrongPassword!123';
    const email1 = `applicant.${runId}@example.com`;
    const email2 = `pi.${runId}@example.com`;

    // Setup User One (Applicant) and User Two (PI)
    const user1Id = await client1.register(email1, `科研学子-${runId}`, password);
    const user2Id = await client2.register(email2, `导师PI-${runId}`, password);
    check('user one registered and logged in', Boolean(user1Id));
    check('user two registered and logged in', Boolean(user2Id));

    const campusesRes = await client2.call('/api/v1/campuses');
    const campuses = (nested(campusesRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    const campusId = campuses[0]?.id ? String(campuses[0].id) : undefined;

    // Organization Setup by User Two
    const orgRes = await client2.call('/api/v1/organizations', {
      method: 'POST',
      body: {
        name: `具身智能实验室-${runId}`,
        slug: `embodied-lab-${runId}`,
        type: 'research_group',
        description: '致力于具身机器人强化学习前沿研究',
        campusId,
      },
    });
    const orgId = String(nested(orgRes.body, ['id']));
    check(
      'organization created',
      orgRes.status === 201 && Boolean(orgId),
      JSON.stringify(orgRes.body),
    );

    // Create & Publish Opportunity
    const oppRes = await client2.call(`/api/v1/organizations/${orgId}/opportunities`, {
      method: 'POST',
      body: {
        title: '具身机器人强化学习研究助理',
        summary: '开展机械臂视觉多模态强化学习算法实现与真机实验',
        description: '要求具备扎实的数学基础与 PyTorch/Isaac Gym 经验。',
        domains: ['机器人', '强化学习', '具身智能'],
        requirements: ['Python', '强化学习基础'],
        stage: 'any',
        headcount: 2,
        commitmentHoursPerWeek: 15,
        remoteOk: false,
        visibility: 'public',
      },
    });
    const oppId = String(nested(oppRes.body, ['id']));
    check(
      'opportunity draft created',
      oppRes.status === 201 && Boolean(oppId),
      JSON.stringify(oppRes.body),
    );

    const pubRes = await client2.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/publish`,
      {
        method: 'POST',
        body: { expectedVersion: 1 },
      },
    );
    check(
      'opportunity published to campus',
      pubRes.status === 200 && nested(pubRes.body, ['status']) === 'open',
      JSON.stringify(pubRes.body),
    );

    // M5-01: Intent Creation & Management
    const intentRes = await client1.call('/api/v1/intents', {
      method: 'POST',
      body: {
        title: '寻求具身智能与大模型科研实习',
        description: '希望在强化学习、具身智能及多模态决策方向进行深入的实验研究。',
        domains: ['机器人', '强化学习'],
        desiredStages: ['undergraduate', 'master', 'any'],
        remoteOk: false,
        commitmentHoursPerWeek: 15,
      },
    });
    const intentId = String(nested(intentRes.body, ['id']));
    check(
      'M5-01: intent created',
      intentRes.status === 201 && Boolean(intentId),
      JSON.stringify(intentRes.body),
    );

    const myIntentsRes = await client1.call('/api/v1/intents/me');
    const myIntents = (nested(myIntentsRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    check(
      'M5-01: list my intents returns created intent',
      myIntents.some((i) => i.id === intentId),
      JSON.stringify(myIntentsRes.body),
    );

    // M5-02: Matching Candidate Generation & Explainability
    const matchGenRes = await client1.call(`/api/v1/intents/${intentId}/matches/generate`, {
      method: 'POST',
      body: { algorithmVersion: 'v1' },
    });
    check('M5-02: generate match candidates succeeds', matchGenRes.status === 200);

    const matchesRes = await client1.call(`/api/v1/intents/${intentId}/matches`);
    const matches = (nested(matchesRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    const matchedOpp = matches.find((m) => m.opportunityId === oppId);
    check(
      'M5-02: matching candidates include published opportunity',
      Boolean(matchedOpp),
      JSON.stringify(matchesRes.body),
    );
    check(
      'M5-02: matching candidate includes explainable score and reasons',
      Boolean(matchedOpp?.score !== undefined && Array.isArray(matchedOpp?.reasons)),
    );

    // M5-03: Purpose-bound Consent Preview
    const previewRes = await client1.call('/api/v1/consents/previews', {
      method: 'POST',
      body: {
        opportunityId: oppId,
        intentId,
        purposeScopes: {
          referral: { fields: ['display_name', 'skills'], expiresInDays: 14 },
          relationship_context: { fields: ['projects', 'bio'] },
        },
      },
    });
    const previewId = String(nested(previewRes.body, ['previewId']));
    check(
      'M5-03: consent preview created with bounded scopes',
      previewRes.status === 201 && Boolean(previewId),
      JSON.stringify(previewRes.body),
    );

    // M5-04: Formal Referral Creation & Two-way Decision
    const referralRes = await client1.call('/api/v1/referrals', {
      method: 'POST',
      body: {
        previewId,
        candidateId: matchedOpp?.id,
      },
    });
    const referralId = String(nested(referralRes.body, ['id']));
    check(
      'M5-04: referral created with status sent',
      referralRes.status === 201 && nested(referralRes.body, ['status']) === 'sent',
      JSON.stringify(referralRes.body),
    );

    // Organization PI sees the referral
    const orgReferralsRes = await client2.call(`/api/v1/organizations/${orgId}/referrals`);
    const orgReferrals =
      (nested(orgReferralsRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    check(
      'M5-04: organization PI lists received referral',
      orgReferrals.some((r) => r.id === referralId),
      JSON.stringify(orgReferralsRes.body),
    );

    // Organization PI reads authorized shared snapshot
    const snapshotRes = await client2.call(`/api/v1/referrals/${referralId}/shared-snapshot`);
    check(
      'M5-04: organization reads authorized shared snapshot',
      snapshotRes.status === 200 && Boolean(nested(snapshotRes.body, ['snapshot'])),
      JSON.stringify(snapshotRes.body),
    );

    // Organization PI decides: accept referral
    const acceptRes = await client2.call(`/api/v1/referrals/${referralId}/decisions`, {
      method: 'POST',
      body: {
        decision: 'accepted',
        reason: '非常匹配课题组方向，欢迎加入！',
        expectedVersion: 1,
      },
    });
    check(
      'M5-04: organization accepts referral',
      acceptRes.status === 200 && nested(acceptRes.body, ['status']) === 'accepted',
      JSON.stringify(acceptRes.body),
    );

    // M5-05: Atomic Relationship Establishment
    const relRes = await client2.call('/api/v1/relationships', {
      method: 'POST',
      body: {
        referralId,
      },
    });
    const relationshipId = String(nested(relRes.body, ['id']));
    check(
      'M5-05: relationship established atomically with active status',
      relRes.status === 201 && nested(relRes.body, ['status']) === 'active',
      JSON.stringify(relRes.body),
    );

    // M5-06: Relationship Space & Authorized Context Retrieval
    const contextRes = await client2.call(`/api/v1/relationships/${relationshipId}/context`);
    const sharedContext = nested(contextRes.body, ['sharedContext']) as Record<string, unknown>;
    check(
      'M5-06: shared context accessible by organization lead',
      contextRes.status === 200 && Object.keys(sharedContext).length > 0,
      JSON.stringify(contextRes.body),
    );

    // M5-07: Consent Revocation Real-Time Propagation & Instant Downstream Blocking
    // Look up the relationship_context consent grant for this referral
    const grantDbRes = await withRequestContext(
      pool,
      { principalId: user1Id, userId: user1Id },
      async (client) =>
        client.query<{ id: string }>(
          'SELECT id FROM public.consent_grants WHERE referral_id = $1 AND purpose = $2',
          [referralId, 'relationship_context'],
        ),
    );
    const grantId = grantDbRes.rows[0]?.id;
    check(
      'M5-07: relationship_context consent grant exists',
      Boolean(grantId),
      `referralId: ${referralId}`,
    );

    if (grantId) {
      // User One revokes consent
      const revokeRes = await client1.call(`/api/v1/consents/grants/${grantId}/revoke`, {
        method: 'POST',
        body: {
          reason: '科研实习项目调整，自主撤回资料授权',
        },
      });
      check(
        'M5-07: user one revokes consent grant',
        revokeRes.status === 200 && nested(revokeRes.body, ['revoked']) === true,
      );

      // Verify immediate downstream blocking for organization lead
      const blockedContextRes = await client2.call(
        `/api/v1/relationships/${relationshipId}/context`,
      );
      const blockedContext = nested(blockedContextRes.body, ['sharedContext']) as Record<
        string,
        unknown
      >;
      check(
        'M5-07: revocation instantly blocks downstream relationship shared context',
        blockedContextRes.status === 200 && Object.keys(blockedContext ?? {}).length === 0,
      );
    }

    // Close relationship
    const closeRes = await client1.call(`/api/v1/relationships/${relationshipId}/close`, {
      method: 'POST',
      body: { reason: '课题合作顺利结题' },
    });
    check(
      'M5-05/06: participant closes relationship',
      closeRes.status === 200 && nested(closeRes.body, ['status']) === 'closed',
    );
  } finally {
    await app.close();
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n${failed} M5 verification checks failed.`);
    process.exit(1);
  } else {
    console.log('\nAll M5 journey verification checks passed cleanly!');
  }
}

main().catch((err) => {
  console.error('Fatal M5 journey error:', err);
  process.exit(1);
});
