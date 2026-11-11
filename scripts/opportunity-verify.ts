import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPool } from '../packages/database/dist/index.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AppModule } from '../apps/api/dist/app.module.js';

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
  const pool = createPool('aven_migrator', { max: 2 });
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
    const campusStudentClient = new Client(baseUrl);
    const strangerClient = new Client(baseUrl);

    const stamp = Date.now();
    const ownerUserId = await ownerClient.register(
      `opp_owner_${stamp}@xjtu.edu.cn`,
      '实验室负责人',
      'AvenPassword123!',
    );
    const memberUserId = await memberClient.register(
      `opp_member_${stamp}@xjtu.edu.cn`,
      '实验室成员',
      'AvenPassword123!',
    );
    const studentUserId = await campusStudentClient.register(
      `opp_student_${stamp}@xjtu.edu.cn`,
      '交大学生',
      'AvenPassword123!',
    );
    const strangerUserId = await strangerClient.register(
      `opp_stranger_${stamp}@example.com`,
      '外部访客',
      'AvenPassword123!',
    );

    check(
      'users register and log in successfully',
      Boolean(ownerUserId && memberUserId && studentUserId && strangerUserId),
    );

    // Get active campus
    const campusesRes = await ownerClient.call('/api/v1/campuses');
    const campuses = (record(campusesRes.body).data as Array<{ id: string }>) ?? [];
    const campusId = campuses[0]?.id;
    check('campus is available', Boolean(campusId));

    // Grant verified campus membership to campusStudentClient directly in database for testing
    if (campusId) {
      await pool.query(
        `INSERT INTO public.campus_memberships (campus_id, user_id, status, verified_at)
         VALUES ($1, $2, 'verified', now())
         ON CONFLICT (campus_id, user_id) DO UPDATE SET status = 'verified', verified_at = now()`,
        [campusId, studentUserId],
      );
    }

    // 1. Create Organization
    const createOrgRes = await ownerClient.call('/api/v1/organizations', {
      method: 'POST',
      body: {
        name: '智能人机协作实验室',
        slug: `collab-lab-${stamp}`,
        description: '专注于人机交互与机器人辅助协作研究',
        type: 'lab',
        campusId,
      },
    });
    const orgId = nested(createOrgRes.body, ['id']) as string;
    check('organization creation succeeds', createOrgRes.status === 201 && Boolean(orgId));

    // Invite and accept memberClient as member
    const inviteRes = await ownerClient.call(`/api/v1/organizations/${orgId}/invitations`, {
      method: 'POST',
      body: { email: `opp_member_${stamp}@xjtu.edu.cn`, role: 'member' },
    });
    check('invite member succeeds', inviteRes.status === 201);
    const inviteToken = readMail('invite_organization', `opp_member_${stamp}@xjtu.edu.cn`);
    const acceptRes = await memberClient.call('/api/v1/organization-invitations/accept', {
      method: 'POST',
      body: { token: inviteToken },
    });
    check('member accepts invitation', acceptRes.status === 200);

    // 2. M4-01: Update organization profile
    const updateOrgRes = await ownerClient.call(`/api/v1/organizations/${orgId}`, {
      method: 'PATCH',
      body: {
        name: '智能协作与具身系统实验室',
        description: '更新后的实验室介绍：具身智能、遥操作与人机协作',
        websiteUrl: 'https://collab.xjtu.edu.cn',
      },
    });
    check(
      'owner can update organization profile',
      updateOrgRes.status === 200 &&
        nested(updateOrgRes.body, ['name']) === '智能协作与具身系统实验室',
      updateOrgRes,
    );

    const memberUpdateOrgRes = await memberClient.call(`/api/v1/organizations/${orgId}`, {
      method: 'PATCH',
      body: { name: '越权修改' },
    });
    check('ordinary member cannot update organization profile', memberUpdateOrgRes.status === 403);

    const strangerUpdateOrgRes = await strangerClient.call(`/api/v1/organizations/${orgId}`, {
      method: 'PATCH',
      body: { name: '越权修改' },
    });
    check('stranger cannot update organization profile', strangerUpdateOrgRes.status === 403);

    // Public organization profile retrieval
    const publicOrgRes = await strangerClient.call(`/api/v1/organizations/${orgId}/public`);
    check(
      'public organization profile is readable by stranger',
      publicOrgRes.status === 200 &&
        nested(publicOrgRes.body, ['name']) === '智能协作与具身系统实验室' &&
        nested(publicOrgRes.body, ['websiteUrl']) === 'https://collab.xjtu.edu.cn',
      publicOrgRes,
    );

    // 3. M4-02: Opportunity lifecycle
    // Ordinary member cannot create opportunity draft
    const memberCreateOpp = await memberClient.call(
      `/api/v1/organizations/${orgId}/opportunities`,
      {
        method: 'POST',
        body: {
          title: '越权助理',
          summary: '摘要',
          description: '描述',
        },
      },
    );
    check('ordinary member cannot create opportunity draft', memberCreateOpp.status === 403);

    // Owner creates opportunity draft
    const draftRes = await ownerClient.call(`/api/v1/organizations/${orgId}/opportunities`, {
      method: 'POST',
      body: {
        title: '多模态灵巧手抓取科研助理',
        summary: '开展视触觉融合感知与灵巧手策略研究',
        description: '每周投入 10-15 小时，要求熟悉 PyTorch 及机器人动力学基础。',
        domains: ['机器人', '触觉感知'],
        requirements: ['Python', 'PyTorch', 'ROS2'],
        stage: 'undergraduate',
        commitmentHoursPerWeek: 15,
        location: '创新港巨构 3 号 3012',
        remoteOk: false,
        headcount: 2,
        visibility: 'campus',
        contactUserId: ownerUserId,
      },
    });
    const oppId = nested(draftRes.body, ['id']) as string;
    check(
      'owner creates opportunity draft',
      draftRes.status === 201 &&
        nested(draftRes.body, ['status']) === 'draft' &&
        nested(draftRes.body, ['version']) === 1,
      draftRes,
    );

    // Contact user must be active organization member
    const invalidContactRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities`,
      {
        method: 'POST',
        body: {
          title: '测试非法联系人',
          summary: '摘要',
          description: '描述',
          contactUserId: strangerUserId,
        },
      },
    );
    check('contact user must be active org member', invalidContactRes.status === 422);

    // Draft isolation:
    // Org member can list opportunities including draft
    const orgOppsRes = await memberClient.call(`/api/v1/organizations/${orgId}/opportunities`);
    const orgOpps = (record(orgOppsRes.body).data as Array<{ id: string; status: string }>) ?? [];
    check(
      'organization member sees draft in organization opportunity list',
      orgOpps.some((item) => item.id === oppId && item.status === 'draft'),
    );

    // Non-member gets 404 when querying draft
    const strangerGetDraft = await strangerClient.call(`/api/v1/opportunities/${oppId}`);
    check('stranger cannot get draft opportunity', strangerGetDraft.status === 404);

    const studentGetDraft = await campusStudentClient.call(`/api/v1/opportunities/${oppId}`);
    check('student cannot get draft opportunity', studentGetDraft.status === 404);

    // Public list excludes draft
    const publicList1 = await campusStudentClient.call('/api/v1/opportunities');
    const publicOpps1 = (record(publicList1.body).data as Array<{ id: string }>) ?? [];
    check(
      'public opportunity list excludes drafts',
      !publicOpps1.some((item) => item.id === oppId),
    );

    // 4. Update opportunity with version check
    const staleUpdateRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}`,
      {
        method: 'PATCH',
        body: {
          expectedVersion: 999,
          title: '冲突更新',
        },
      },
    );
    check('stale version update returns 409 conflict', staleUpdateRes.status === 409);

    const updateOppRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}`,
      {
        method: 'PATCH',
        body: {
          expectedVersion: 1,
          title: '多模态灵巧手遥操作与强化学习科研助理',
          commitmentHoursPerWeek: 12,
        },
      },
    );
    check(
      'valid update increments version',
      updateOppRes.status === 200 &&
        nested(updateOppRes.body, ['version']) === 2 &&
        nested(updateOppRes.body, ['commitmentHoursPerWeek']) === 12,
    );

    // 5. Publish opportunity
    const stalePublishRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/publish`,
      {
        method: 'POST',
        body: { expectedVersion: 1 },
      },
    );
    check('stale version publish returns 409 conflict', stalePublishRes.status === 409);

    const publishRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/publish`,
      {
        method: 'POST',
        body: { expectedVersion: 2 },
      },
    );
    check(
      'publish opportunity sets status open and publishedAt',
      publishRes.status === 200 &&
        nested(publishRes.body, ['status']) === 'open' &&
        nested(publishRes.body, ['version']) === 3 &&
        Boolean(nested(publishRes.body, ['publishedAt'])),
    );

    // 6. Visibility checks for campus opportunity
    // Verified campus student can view campus opportunity
    const studentGetOpp = await campusStudentClient.call(`/api/v1/opportunities/${oppId}`);
    check(
      'verified campus student can view campus opportunity',
      studentGetOpp.status === 200 && nested(studentGetOpp.body, ['id']) === oppId,
    );

    // Unverified / external stranger cannot view campus opportunity (404)
    const strangerGetOpp = await strangerClient.call(`/api/v1/opportunities/${oppId}`);
    check('external stranger cannot view campus opportunity', strangerGetOpp.status === 404);

    // Verified student sees opportunity in campus filtered list
    const studentListOpps = await campusStudentClient.call(
      `/api/v1/opportunities?campusId=${campusId}&stage=undergraduate&domain=机器人`,
    );
    const studentList = (record(studentListOpps.body).data as Array<{ id: string }>) ?? [];
    check(
      'verified student sees opportunity with campus and domain filters',
      studentList.some((item) => item.id === oppId),
    );

    // 7. Pause and re-publish opportunity
    const pauseRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/pause`,
      {
        method: 'POST',
        body: { expectedVersion: 3 },
      },
    );
    check(
      'pause opportunity sets status paused',
      pauseRes.status === 200 &&
        nested(pauseRes.body, ['status']) === 'paused' &&
        nested(pauseRes.body, ['version']) === 4,
    );

    // Paused opportunity does not appear in public / student list
    const studentListPaused = await campusStudentClient.call('/api/v1/opportunities');
    const pausedList = (record(studentListPaused.body).data as Array<{ id: string }>) ?? [];
    check(
      'paused opportunity is excluded from public discovery',
      !pausedList.some((item) => item.id === oppId),
    );

    // Re-publish opportunity
    const republishRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/publish`,
      {
        method: 'POST',
        body: { expectedVersion: 4 },
      },
    );
    check(
      'republish paused opportunity succeeds',
      republishRes.status === 200 && nested(republishRes.body, ['status']) === 'open',
    );

    // 8. Close opportunity
    const closeRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/close`,
      {
        method: 'POST',
        body: { expectedVersion: 5 },
      },
    );
    check(
      'close opportunity sets status closed and closedAt',
      closeRes.status === 200 &&
        nested(closeRes.body, ['status']) === 'closed' &&
        Boolean(nested(closeRes.body, ['closedAt'])),
    );

    // Closed opportunity cannot be edited or reopened
    const updateClosedRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}`,
      {
        method: 'PATCH',
        body: { expectedVersion: 6, title: '修改已关闭机会' },
      },
    );
    check('closed opportunity cannot be updated', updateClosedRes.status === 422);

    const publishClosedRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/publish`,
      {
        method: 'POST',
        body: { expectedVersion: 6 },
      },
    );
    check('closed opportunity cannot be published', publishClosedRes.status === 422);

    // Duplicate close is idempotent
    const duplicateCloseRes = await ownerClient.call(
      `/api/v1/organizations/${orgId}/opportunities/${oppId}/close`,
      {
        method: 'POST',
        body: { expectedVersion: 6 },
      },
    );
    check('duplicate close is idempotent', duplicateCloseRes.status === 200);

    // 9. CSRF protection verification
    const csrfBypassRes = await ownerClient.call(`/api/v1/organizations/${orgId}/opportunities`, {
      method: 'POST',
      csrf: false,
      body: {
        title: 'CSRF 绕过测试',
        summary: '摘要',
        description: '描述',
      },
    });
    check('opportunity creation without CSRF is rejected', csrfBypassRes.status === 403);

    // 10. Public visibility opportunity creation and access
    const publicOppRes = await ownerClient.call(`/api/v1/organizations/${orgId}/opportunities`, {
      method: 'POST',
      body: {
        title: '全网公开开源大模型调优志愿者',
        summary: '协助构建高质量开源微调评测集',
        description: '面向全网公开招募，线上远程协作。',
        domains: ['开源', '大模型'],
        requirements: ['Git', 'Python'],
        stage: 'any',
        headcount: 5,
        remoteOk: true,
        visibility: 'public',
      },
    });
    const publicOppId = nested(publicOppRes.body, ['id']) as string;
    await ownerClient.call(`/api/v1/organizations/${orgId}/opportunities/${publicOppId}/publish`, {
      method: 'POST',
      body: { expectedVersion: 1 },
    });

    const strangerGetPublicOpp = await strangerClient.call(`/api/v1/opportunities/${publicOppId}`);
    check(
      'public visibility opportunity is accessible by external stranger',
      strangerGetPublicOpp.status === 200 &&
        nested(strangerGetPublicOpp.body, ['title']) === '全网公开开源大模型调优志愿者',
    );

    // 11. Due opportunities expiration
    await pool.query(
      `UPDATE public.opportunities SET deadline = now() - interval '1 second' WHERE id = $1`,
      [publicOppId],
    );
    const expiredCheck = await strangerClient.call(`/api/v1/opportunities/${publicOppId}`);
    check(
      'past-deadline opportunity dynamically reports expired status',
      expiredCheck.status === 200 && nested(expiredCheck.body, ['status']) === 'expired',
    );

    const publicListAfterExpiry = await strangerClient.call('/api/v1/opportunities');
    const listAfterExpiry =
      (record(publicListAfterExpiry.body).data as Array<{ id: string }>) ?? [];
    check(
      'expired opportunity is excluded from public discovery list',
      !listAfterExpiry.some((item) => item.id === publicOppId),
    );
  } finally {
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }

  console.log(`\nAll opportunity checks complete. Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : 'Opportunity verification failed.',
  );
  process.exitCode = 1;
});
