import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
  const client2 = new Client(baseUrl); // Org Owner / Admin
  const client3 = new Client(baseUrl); // Outsider
  const pool = createApplicationPool();
  const workerPool = createPool('aven_worker');
  const migratorPool = createPool('aven_migrator');

  try {
    const runId = randomUUID().slice(0, 8);
    const password = 'StrongPassword!123';
    const email1 = `applicant.${runId}@example.com`;
    const email2 = `orgowner.${runId}@example.com`;
    const email3 = `outsider.${runId}@example.com`;

    // 1. Register users
    const user1Id = await client1.register(email1, 'Applicant One', password);
    const user2Id = await client2.register(email2, 'Lab PI', password);
    const user3Id = await client3.register(email3, 'Outsider User', password);
    check('three test accounts registered and verified', !!user1Id && !!user2Id && !!user3Id);

    const campusesRes = await client2.call('/api/v1/campuses');
    const campuses = (nested(campusesRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    const campusId = campuses[0]?.id ? String(campuses[0].id) : undefined;

    // 2. User 2 creates organization & publishes opportunity
    const orgRes = await client2.call('/api/v1/organizations', {
      method: 'POST',
      body: {
        name: `AI Safety Lab ${runId}`,
        slug: `ai-safety-${runId}`,
        type: 'research_group',
        description: 'Assisting research on formal reasoning',
        campusId,
      },
    });
    const orgId = String(nested(orgRes.body, ['id']));
    check(
      'organization created',
      orgRes.status === 201 && Boolean(orgId),
      JSON.stringify(orgRes.body),
    );

    const oppRes = await client2.call(`/api/v1/organizations/${orgId}/opportunities`, {
      method: 'POST',
      body: {
        title: `Research Assistant ${runId}`,
        summary: 'Assisting research on formal reasoning and AI safety',
        description: 'Assisting research on formal reasoning',
        domains: ['AI Safety', 'Formal Reasoning'],
        requirements: ['Logic', 'Python'],
        stage: 'any',
        headcount: 2,
        commitmentHoursPerWeek: 15,
        remoteOk: false,
        visibility: 'public',
      },
    });
    const oppId = String(nested(oppRes.body, ['id']));
    check(
      'opportunity created',
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
    check('opportunity published', pubRes.status === 200, JSON.stringify(pubRes.body));

    // 3. User 1 creates intent & preview & sends referral
    const intentRes = await client1.call('/api/v1/intents', {
      method: 'POST',
      body: {
        title: 'Looking for reasoning research',
        description: 'Background in math and logic',
        domains: ['Formal Reasoning'],
        desiredStages: ['undergraduate', 'master', 'any'],
        remoteOk: false,
        commitmentHoursPerWeek: 15,
      },
    });
    const intentId = String(nested(intentRes.body, ['id']));
    check(
      'applicant creates intent',
      intentRes.status === 201 && Boolean(intentId),
      JSON.stringify(intentRes.body),
    );

    const previewRes = await client1.call('/api/v1/consents/previews', {
      method: 'POST',
      body: {
        opportunityId: oppId,
        intentId: intentId,
        purposeScopes: {
          referral: { fields: ['display_name', 'email'], expiresInDays: 14 },
          relationship_context: { fields: ['projects', 'bio'] },
        },
      },
    });
    const previewId = String(nested(previewRes.body, ['previewId']));
    check(
      'consent preview created',
      previewRes.status === 201 && Boolean(previewId),
      JSON.stringify(previewRes.body),
    );

    const refRes = await client1.call('/api/v1/referrals', {
      method: 'POST',
      body: { previewId },
    });
    const refId = String(nested(refRes.body, ['id']));
    const initialVersion = Number(nested(refRes.body, ['version']));
    const initialContentVersion = Number(nested(refRes.body, ['contentVersion']));
    check(
      'referral created with status=sent and contentVersion=1',
      refRes.status === 201 &&
        nested(refRes.body, ['status']) === 'sent' &&
        initialContentVersion === 1,
      JSON.stringify(refRes.body),
    );

    // 4. Org admin inspects and requests info
    const reqInfoRes = await client2.call(`/api/v1/referrals/${refId}/decisions`, {
      method: 'POST',
      body: {
        decision: 'info_requested',
        reason: 'Please provide links to your GitHub and recent publications.',
        expectedVersion: initialVersion,
      },
    });
    check(
      'org requests info -> status transitions to info_requested',
      reqInfoRes.status === 200 && record(reqInfoRes.body).status === 'info_requested',
    );
    const versionAfterReqInfo = Number(record(reqInfoRes.body).version);

    // 5. Outsider attempts to submit supplement -> forbidden (403)
    const outsiderSubmit = await client3.call(`/api/v1/referrals/${refId}/supplements`, {
      method: 'POST',
      body: {
        content: 'I am an outsider submitting unauthorized supplement',
        expectedVersion: versionAfterReqInfo,
      },
    });
    check('outsider cannot submit supplement (403)', outsiderSubmit.status === 403);

    // 6. Outsider attempts to view supplements -> forbidden (403)
    const outsiderList = await client3.call(`/api/v1/referrals/${refId}/supplements`, {
      method: 'GET',
    });
    check('outsider cannot list supplements (403)', outsiderList.status === 403);

    // 7. Applicant submits with stale version -> conflict (409)
    const staleSubmit = await client1.call(`/api/v1/referrals/${refId}/supplements`, {
      method: 'POST',
      body: {
        content: 'Valid content but wrong version',
        expectedVersion: 999,
      },
    });
    check('stale expectedVersion is rejected with 409 conflict', staleSubmit.status === 409);

    // 8. Applicant submits valid supplement 1
    const sup1Content =
      'GitHub: https://github.com/applicant-one/reasoning-bench. Pre-print: arXiv:2611.99999';
    const sup1Res = await client1.call(`/api/v1/referrals/${refId}/supplements`, {
      method: 'POST',
      body: {
        content: sup1Content,
        expectedVersion: versionAfterReqInfo,
      },
    });
    check(
      'applicant submits supplement 1 successfully (201)',
      sup1Res.status === 201 &&
        record(sup1Res.body).supplementVersion === 1 &&
        record(sup1Res.body).content === sup1Content,
    );

    // 9. Verify referral state after supplement 1
    const refAfterSup1 = await client1.call(`/api/v1/referrals/${refId}`);
    check(
      'referral status transitions back to sent and contentVersion increments to 2',
      refAfterSup1.status === 200 &&
        record(refAfterSup1.body).status === 'sent' &&
        record(refAfterSup1.body).contentVersion === 2,
    );
    const versionAfterSup1 = Number(record(refAfterSup1.body).version);

    // 10. Org decision is reset to pending with referral_content_version = 2
    const orgDecisionCheck = await withRequestContext(
      pool,
      { principalId: orgId, userId: user2Id },
      async (db) => {
        const r = await db.query<{
          decision: string;
          referral_content_version: number;
          reason: string | null;
        }>(
          `SELECT decision, referral_content_version, reason FROM public.referral_decisions WHERE referral_id = $1 AND side = 'organization'`,
          [refId],
        );
        return r.rows[0];
      },
    );
    check(
      'org decision is reset to pending on new contentVersion 2',
      orgDecisionCheck?.decision === 'pending' &&
        orgDecisionCheck?.referral_content_version === 2 &&
        orgDecisionCheck?.reason === null,
    );

    // 11. Both applicant and org admin can read the supplements list
    const listApplicant = await client1.call(`/api/v1/referrals/${refId}/supplements`);
    const supplementsApp = record(listApplicant.body).supplements as Array<Record<string, unknown>>;
    check(
      'applicant can list supplements',
      listApplicant.status === 200 &&
        supplementsApp.length === 1 &&
        supplementsApp[0]?.content === sup1Content,
    );

    const listOrg = await client2.call(`/api/v1/referrals/${refId}/supplements`);
    const supplementsOrg = record(listOrg.body).supplements as Array<Record<string, unknown>>;
    check(
      'org admin can list supplements',
      listOrg.status === 200 &&
        supplementsOrg.length === 1 &&
        supplementsOrg[0]?.content === sup1Content,
    );

    // 12. Applicant submits supplement 2
    const sup2Content = 'Note: Also available for 15 hours per week starting next month.';
    const sup2Res = await client1.call(`/api/v1/referrals/${refId}/supplements`, {
      method: 'POST',
      body: {
        content: sup2Content,
        expectedVersion: versionAfterSup1,
      },
    });
    check(
      'applicant submits supplement 2 (supplementVersion=2, contentVersion=3)',
      sup2Res.status === 201 && record(sup2Res.body).supplementVersion === 2,
    );

    const refAfterSup2 = await client1.call(`/api/v1/referrals/${refId}`);
    check('referral contentVersion is now 3', record(refAfterSup2.body).contentVersion === 3);
    const versionAfterSup2 = Number(record(refAfterSup2.body).version);

    // 13. Org admin accepts referral based on updated content
    const acceptRes = await client2.call(`/api/v1/referrals/${refId}/decisions`, {
      method: 'POST',
      body: {
        decision: 'accepted',
        reason: 'Both supplements reviewed and approved. Welcome to the lab!',
        expectedVersion: versionAfterSup2,
      },
    });
    check(
      'org admin accepts referral with updated content',
      acceptRes.status === 200 && record(acceptRes.body).status === 'accepted',
    );

    // 14. Cannot submit supplement when in terminal state (accepted)
    const terminalSubmit = await client1.call(`/api/v1/referrals/${refId}/supplements`, {
      method: 'POST',
      body: {
        content: 'Cannot add supplement after acceptance',
        expectedVersion: Number(record(acceptRes.body).version),
      },
    });
    check(
      'cannot submit supplement after referral is accepted (terminal state 409)',
      terminalSubmit.status === 409,
    );

    // 15. Relationship established atomically from accepted referral
    const relRes = await client2.call('/api/v1/relationships', {
      method: 'POST',
      body: { referralId: refId },
    });
    check('atomic relationship established', relRes.status === 201 && !!record(relRes.body).id);

    // 16. Worker maintenance test (app.maintain_referrals)
    // Create dummy referral and consent grant with past expires_at using user3Id
    const dummyIntentRes = await client3.call('/api/v1/intents', {
      method: 'POST',
      body: {
        title: 'Dummy intent for expiration testing',
        description: 'For worker maintenance verification',
        domains: ['Formal Reasoning'],
        desiredStages: ['any'],
        remoteOk: false,
        commitmentHoursPerWeek: 10,
      },
    });
    const dummyIntentId = String(nested(dummyIntentRes.body, ['id']));
    const dummyRefId = randomUUID();
    const dummyGrantId = randomUUID();
    await migratorPool.query(`
      INSERT INTO public.referrals(id, applicant_user_id, intent_id, opportunity_id, organization_id, status, created_at, expires_at)
      VALUES ('${dummyRefId}'::uuid, '${user3Id}'::uuid, '${dummyIntentId}'::uuid, '${oppId}'::uuid, '${orgId}'::uuid, 'sent', clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 hour');

      INSERT INTO public.consent_grants(id, grantor_principal_id, grantee_principal_id, referral_id, purpose, status, created_at, expires_at)
      VALUES ('${dummyGrantId}'::uuid, '${user3Id}'::uuid, '${orgId}'::uuid, '${dummyRefId}'::uuid, 'referral', 'active', clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 hour');
    `);

    // App role attempt to run maintenance is blocked (42501)
    let appBlocked = false;
    try {
      await pool.query('SELECT app.maintain_referrals(100)');
    } catch {
      appBlocked = true;
    }
    check('app role cannot execute maintain_referrals', appBlocked);

    // Worker role runs maintain_referrals
    const maintRes = await workerPool.query<{
      maintain_referrals: { expiredReferralsCount: number; expiredGrantsCount: number };
    }>('SELECT app.maintain_referrals(100)');
    const maintCounts = maintRes.rows[0]?.maintain_referrals;
    check(
      'worker successfully runs maintain_referrals',
      Number(maintCounts?.expiredReferralsCount) >= 1 &&
        Number(maintCounts?.expiredGrantsCount) >= 1,
    );

    // Verify dummy referral status changed to expired
    const checkExpiredRef = await migratorPool.query<{ status: string }>(
      `SELECT status FROM public.referrals WHERE id = '${dummyRefId}'::uuid`,
    );
    check(
      'expired referral transitioned to status=expired',
      checkExpiredRef.rows[0]?.status === 'expired',
    );

    // 17. Security check: aven_app cannot directly write to referral_supplements
    let directInsertBlocked = false;
    try {
      await pool.query(`
        INSERT INTO public.referral_supplements(referral_id, supplement_version, author_user_id, content)
        VALUES ('${refId}'::uuid, 999, '${user1Id}'::uuid, 'Direct insert attempt')
      `);
    } catch {
      directInsertBlocked = true;
    }
    check('app role cannot directly insert into referral_supplements', directInsertBlocked);
  } catch (error) {
    console.error('Fatal test error:', error);
    failed += 1;
  } finally {
    await app.close();
    await pool.end();
    await workerPool.end();
    await migratorPool.end();
  }

  if (failed > 0) {
    console.error(`\n${failed} checks failed.`);
    process.exit(1);
  } else {
    console.log('\nAll referral supplement and lifecycle maintenance checks passed cleanly!\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
