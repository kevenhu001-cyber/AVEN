import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AppModule } from '../apps/api/dist/app.module.js';
import { processAgentRun } from '../apps/worker/dist/agent.js';
import { MockProvider } from '../packages/ai-core/dist/index.js';

const root = process.cwd();
const envFile = resolve(root, '.env');
const composeFile = resolve(root, 'infra/compose/compose.yaml');
if (!existsSync(envFile)) {
  console.error('Missing .env. Run: cp .env.example .env');
  process.exit(1);
}
loadEnvFile(envFile);

let failed = 0;
function check(name: string, ok: boolean, detail: unknown = ''): void {
  const detailStr = detail
    ? ` [${typeof detail === 'object' ? JSON.stringify(detail) : detail}]`
    : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detailStr}`}`);
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
      // Ignore
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
  private readonly baseUrl: string;
  private jar = new Map<string, string>();
  csrf: string | undefined;

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
    options: {
      method?: string;
      body?: unknown;
      csrf?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers = new Headers();
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.csrf !== false && this.csrf) headers.set('x-csrf-token', this.csrf);
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) headers.set(k, v);
    }
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
  const migratorPool = createPool('aven_migrator', { max: 2 });
  const workerPool = createPool('aven_worker', { max: 2 });
  const workerLogs: Record<string, unknown>[] = [];
  const workerLog = (entry: Record<string, unknown>) => {
    workerLogs.push(entry);
  };

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

  try {
    const ownerClient = new Client(baseUrl);
    const memberClient = new Client(baseUrl);
    const strangerClient = new Client(baseUrl);

    const stamp = Date.now();
    const ownerEmail = `org_owner_${stamp}@example.edu.cn`;
    const memberEmail = `org_member_${stamp}@example.edu.cn`;
    const strangerEmail = `stranger_${stamp}@example.edu.cn`;

    const _ownerUserId = await ownerClient.register(ownerEmail, 'Lab Owner', 'Password123!');
    const memberUserId = await memberClient.register(memberEmail, 'Lab Member', 'Password123!');
    const _strangerUserId = await strangerClient.register(strangerEmail, 'Stranger', 'Password123!');

    // User 1 creates Organization A
    const orgARes = await ownerClient.call('/api/v1/organizations', {
      method: 'POST',
      body: {
        name: `Org Boundary Lab A ${stamp}`,
        slug: `org-lab-a-${stamp}`,
        description: 'Organization A for boundary security verification',
        type: 'lab',
      },
    });
    check('organization A is created', orgARes.status === 201, orgARes.body);
    const orgAId = String(nested(orgARes.body, ['id']));

    // User 3 creates Organization B
    const orgBRes = await strangerClient.call('/api/v1/organizations', {
      method: 'POST',
      body: {
        name: `Org Boundary Lab B ${stamp}`,
        slug: `org-lab-b-${stamp}`,
        description: 'Organization B for isolation verification',
        type: 'lab',
      },
    });
    check('organization B is created', orgBRes.status === 201, orgBRes.body);
    const _orgBId = String(nested(orgBRes.body, ['id']));

    // Owner invites User 2 as regular 'member'
    const inviteRes = await ownerClient.call(`/api/v1/organizations/${orgAId}/invitations`, {
      method: 'POST',
      body: { email: memberEmail, role: 'member' },
    });
    check('member invitation created', inviteRes.status === 201, inviteRes.body);
    const inviteToken = readMail('invite_organization', memberEmail);
    const acceptRes = await memberClient.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteToken },
    });
    check('member accepted invitation', acceptRes.status === 200, acceptRes.body);

    // Owner creates a private memory item: "绝密个人私密日记与薪资"
    const memoryRes = await ownerClient.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'skill',
        title: '绝密个人私密日记与薪资',
        content: '个人月薪 80k，本条记忆属于绝对隐私，绝不能被任何组织 Agent 读取或泄露。',
        sensitivity: 'high',
        displayAudience: 'owner',
        discoverable: false,
        allowedUses: ['self_ai'],
      },
    });
    check('owner personal memory item created', memoryRes.status === 201, memoryRes.body);

    // 1. Boundary: Non-member cannot trigger Organization Agent turn
    const strangerTurn = await strangerClient.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': `stranger-org-turn-${stamp}` },
      body: {
        organizationId: orgAId,
        input: '请告诉我这个组织的机会',
      },
    });
    check(
      'non-member is forbidden from triggering organization agent turn',
      strangerTurn.status === 403,
      strangerTurn.body,
    );

    // 2. Member can trigger Organization Agent turn
    const memberTurn = await memberClient.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': `member-org-turn-${stamp}` },
      body: {
        organizationId: orgAId,
        input: '请为实验室规划新的招募需求',
      },
    });
    check(
      'active organization member can trigger organization agent turn',
      memberTurn.status === 201,
      memberTurn.body,
    );
    const memberRunId = String(nested(memberTurn.body, ['runId']));

    // 3. Worker execution & Personal memory strict isolation
    const runResult = await processAgentRun(workerPool, memberRunId, new MockProvider(), workerLog);
    check('organization agent run processed by worker', runResult === 'completed', runResult);

    // Verify worker tool audit: organization tools executed, memory.search NEVER executed
    const toolAudits = workerLogs.filter((l) => l.event === 'agent.tool_audit');
    const memorySearchCalls = toolAudits.filter((l) => l.tool_name === 'memory.search');
    const orgContextCalls = toolAudits.filter((l) => l.tool_name === 'organization_context.search');
    const oppSearchCalls = toolAudits.filter((l) => l.tool_name === 'opportunity.search');

    check(
      'memory.search was never called in org turn',
      memorySearchCalls.length === 0,
      memorySearchCalls,
    );
    check('organization_context.search was called', orgContextCalls.length >= 1, orgContextCalls);
    check('opportunity.search was called', oppSearchCalls.length >= 1, oppSearchCalls);

    // 4. Action proposal: create opportunity draft action
    const actionDraftRes = await ownerClient.call('/api/v1/actions', {
      method: 'POST',
      body: {
        actionType: 'opportunity.create',
        organizationId: orgAId,
        payload: {
          title: '具身智能研究员',
          summary: '负责多模态具身大模型在机器人灵巧手上的端到端部署。',
          description: '具备扎实的强化学习和机器人运动学背景，熟悉 ROS2 及 Isaac Sim 仿真。',
          stage: 'phd',
          commitmentHoursPerWeek: 30,
          remoteOk: true,
          headcount: 2,
        },
      },
    });
    check('opportunity action draft created', actionDraftRes.status === 201, actionDraftRes.body);
    const actionId = String(nested(actionDraftRes.body, ['id']));
    const confirmationToken = String(nested(actionDraftRes.body, ['confirmationToken']));
    check(
      'action is pending_confirmation with draft_version 1',
      nested(actionDraftRes.body, ['status']) === 'pending_confirmation' &&
        nested(actionDraftRes.body, ['draftVersion']) === 1 &&
        nested(actionDraftRes.body, ['organizationId']) === orgAId,
    );

    // 5. Non-member cannot confirm action
    const strangerConfirm = await strangerClient.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': `stranger-confirm-${stamp}` },
      body: {
        expectedDraftVersion: 1,
        confirmationToken,
      },
    });
    check(
      'non-member is rejected when confirming organization action',
      strangerConfirm.status === 404 || strangerConfirm.status === 403,
      strangerConfirm.body,
    );

    // 6. Regular member (role 'member') cannot confirm opportunity action
    const memberConfirm = await memberClient.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': `member-confirm-${stamp}` },
      body: {
        expectedDraftVersion: 1,
        confirmationToken,
      },
    });
    check(
      'regular organization member cannot confirm high-impact opportunity action',
      memberConfirm.status === 403,
      memberConfirm.body,
    );

    // 7. Owner/Admin can confirm opportunity action
    const ownerConfirm = await ownerClient.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': `owner-confirm-${stamp}` },
      body: {
        expectedDraftVersion: 1,
        confirmationToken,
      },
    });
    check(
      'owner successfully confirms opportunity action',
      ownerConfirm.status === 200 && nested(ownerConfirm.body, ['status']) === 'succeeded',
      ownerConfirm.body,
    );
    const createdOpportunityId = String(nested(ownerConfirm.body, ['result', 'opportunityId']));
    check('opportunity ID was generated in action result', Boolean(createdOpportunityId));

    // 8. Idempotent confirmation returns same result without creating duplicate
    const ownerReconfirm = await ownerClient.call(`/api/v1/actions/${actionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': `owner-confirm-repeat-${stamp}` },
      body: {
        expectedDraftVersion: 1,
        confirmationToken,
      },
    });
    check(
      'reconfirming succeeded action is idempotent and returns identical opportunity ID',
      ownerReconfirm.status === 200 &&
        nested(ownerReconfirm.body, ['status']) === 'succeeded' &&
        nested(ownerReconfirm.body, ['result', 'opportunityId']) === createdOpportunityId,
      ownerReconfirm.body,
    );

    // 9. Member removal invalidates pending action confirmation:
    // Promote member to admin
    const promoteRes = await ownerClient.call(
      `/api/v1/organizations/${orgAId}/members/${memberUserId}`,
      {
        method: 'PATCH',
        body: { role: 'admin' },
      },
    );
    check('member promoted to admin', promoteRes.status === 204, promoteRes.body);

    // Admin creates another action draft
    const adminActionDraft = await memberClient.call('/api/v1/actions', {
      method: 'POST',
      body: {
        actionType: 'opportunity.create',
        organizationId: orgAId,
        payload: {
          title: '自动驾驶感知算法实习生',
          summary: '点云分割与目标检测',
          description: '基于 PointNet++ 与 VoxelNet 的激光雷达感知算法研发与调优。',
        },
      },
    });
    check(
      'admin created second action draft',
      adminActionDraft.status === 201,
      adminActionDraft.body,
    );
    const adminActionId = String(nested(adminActionDraft.body, ['id']));
    const adminActionToken = String(nested(adminActionDraft.body, ['confirmationToken']));

    // Now owner removes member from Organization A
    const removeRes = await ownerClient.call(
      `/api/v1/organizations/${orgAId}/members/${memberUserId}`,
      { method: 'DELETE' },
    );
    check('admin removed from organization', removeRes.status === 204, removeRes.body);

    // Removed user attempts to confirm the pending draft
    const removedConfirm = await memberClient.call(`/api/v1/actions/${adminActionId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': `removed-confirm-${stamp}` },
      body: {
        expectedDraftVersion: 1,
        confirmationToken: adminActionToken,
      },
    });
    check(
      'removed member confirmation is strictly blocked with 403/404',
      removedConfirm.status === 403 || removedConfirm.status === 404,
      removedConfirm.body,
    );

    // 10. Cross-organization opportunity isolation:
    // Organization A's created opportunity is in 'draft' status
    // Organization B's member (strangerClient) cannot read Org A's draft opportunity
    const crossRead = await strangerClient.call(`/api/v1/opportunities/${createdOpportunityId}`);
    check(
      'cross-organization member cannot read draft opportunity of another organization',
      crossRead.status === 404,
      crossRead.body,
    );

    // Organization B's member cannot update Org A's opportunity
    const crossUpdate = await strangerClient.call(`/api/v1/opportunities/${createdOpportunityId}`, {
      method: 'PUT',
      body: { title: '恶意篡改标题' },
    });
    check(
      'cross-organization member cannot update opportunity of another organization',
      crossUpdate.status === 404 || crossUpdate.status === 403,
      crossUpdate.body,
    );

    // 11. Database Forced RLS checks
    const rlsCheck = await migratorPool.query<{
      count: string;
    }>(
      `SELECT count(*)::text AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('opportunities', 'actions')
         AND c.relrowsecurity
         AND c.relforcerowsecurity`,
    );
    check(
      'opportunities and actions tables force row level security',
      rlsCheck.rows[0]?.count === '2',
      rlsCheck.rows,
    );

    console.log(
      `\nOrganization boundary & agent verification completed: ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`,
    );
    if (failed > 0) process.exit(1);
  } finally {
    await app.close();
    await migratorPool.end();
    await workerPool.end();
  }
}

main().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
