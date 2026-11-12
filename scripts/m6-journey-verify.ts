import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplicationPool } from '../packages/database/dist/index.js';
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

  const client1 = new Client(baseUrl); // Applicant / Student
  const client2 = new Client(baseUrl); // PI / Lab Lead
  const pool = createApplicationPool();

  try {
    const runId = randomUUID().slice(0, 8);
    const password = 'StrongPassword!123';
    const email1 = `student.m6.${runId}@example.com`;
    const email2 = `pi.m6.${runId}@example.com`;

    // 1. Setup Users
    const user1Id = await client1.register(email1, `科研学子-${runId}`, password);
    const user2Id = await client2.register(email2, `导师PI-${runId}`, password);
    check('user one registered and logged in', Boolean(user1Id));
    check('user two registered and logged in', Boolean(user2Id));

    // 2. Setup Organization, Opportunity, and Relationship
    const campusesRes = await client2.call('/api/v1/campuses');
    const campuses = (nested(campusesRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    const campusId = campuses[0]?.id ? String(campuses[0].id) : undefined;

    const orgRes = await client2.call('/api/v1/organizations', {
      method: 'POST',
      body: {
        name: `前沿智能实验室-${runId}`,
        slug: `ai-lab-${runId}`,
        type: 'research_group',
        description: '重点研究具身智能与大模型系统',
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
        title: 'M6科研研讨合作项目',
        summary: '开展具身智能算法原型研发',
        description: '深入参与实验室具身智能研讨与实验开展',
        stage: 'undergraduate',
        visibility: 'campus',
        headcount: 2,
        domains: ['机器人', 'AI'],
      },
    });
    const oppId = String(nested(oppRes.body, ['id']));
    await client2.call(`/api/v1/organizations/${orgId}/opportunities/${oppId}/publish`, {
      method: 'POST',
      body: { expectedVersion: 1 },
    });

    // Intent & Matching & Referral & Relationship
    const intentRes = await client1.call('/api/v1/intents', {
      method: 'POST',
      body: {
        title: '寻找具身智能实验室研讨项目',
        description: '深度参与前沿机器人课题研究',
        domains: ['机器人', 'AI'],
        desiredStages: ['undergraduate'],
      },
    });
    const intentId = String(nested(intentRes.body, ['id']));

    const previewRes = await client1.call('/api/v1/consents/previews', {
      method: 'POST',
      body: {
        opportunityId: oppId,
        intentId,
        purposeScopes: {
          referral: { fields: ['display_name', 'skills'] },
          relationship_context: { fields: ['bio'] },
        },
      },
    });
    const previewId = String(nested(previewRes.body, ['previewId']));

    const referralRes = await client1.call('/api/v1/referrals', {
      method: 'POST',
      body: { previewId },
    });
    const referralId = String(nested(referralRes.body, ['id']));

    // PI accepts referral
    await client2.call(`/api/v1/referrals/${referralId}/decisions`, {
      method: 'POST',
      body: {
        decision: 'accepted',
        reason: '非常匹配，欢迎进入项目讨论',
        expectedVersion: 1,
      },
    });

    // Establish Relationship
    const relRes = await client2.call('/api/v1/relationships', {
      method: 'POST',
      body: { referralId },
    });
    const relationshipId = String(nested(relRes.body, ['id']));
    check(
      'prerequisite: relationship established',
      relRes.status === 201 && Boolean(relationshipId),
      JSON.stringify(relRes.body),
    );

    // =========================================================================
    // M6-01: Availability Blocks (个人日程与忙闲块录入)
    // =========================================================================
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(9, 0, 0, 0);

    const user1BusyStart = new Date(tomorrow.getTime() + 1 * 3600 * 1000).toISOString(); // 10:00
    const user1BusyEnd = new Date(tomorrow.getTime() + 3 * 3600 * 1000).toISOString(); // 12:00

    const user2BusyStart = new Date(tomorrow.getTime() + 5 * 3600 * 1000).toISOString(); // 14:00
    const user2BusyEnd = new Date(tomorrow.getTime() + 7 * 3600 * 1000).toISOString(); // 16:00

    const block1Res = await client1.call('/api/v1/availability/blocks', {
      method: 'POST',
      body: {
        startAt: user1BusyStart,
        endAt: user1BusyEnd,
        timezone: 'Asia/Shanghai',
        status: 'busy',
        source: 'manual',
      },
    });
    check(
      'M6-01: user one creates availability block',
      block1Res.status === 200 && Boolean(nested(block1Res.body, ['id'])),
    );

    const block2Res = await client2.call('/api/v1/availability/blocks', {
      method: 'POST',
      body: {
        startAt: user2BusyStart,
        endAt: user2BusyEnd,
        timezone: 'Asia/Shanghai',
        status: 'busy',
        source: 'manual',
      },
    });
    check(
      'M6-01: user two creates availability block',
      block2Res.status === 200 && Boolean(nested(block2Res.body, ['id'])),
    );

    const myBlocksRes = await client1.call('/api/v1/availability/me');
    const myBlocks = (nested(myBlocksRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    check(
      'M6-01: user one lists own availability blocks',
      myBlocks.some((b) => b.id === nested(block1Res.body, ['id'])),
    );

    // =========================================================================
    // M6-01/02: Privacy-Preserving Busy/Free Projection Window
    // =========================================================================
    const windowStart = tomorrow.toISOString(); // 09:00
    const windowEnd = new Date(tomorrow.getTime() + 9 * 3600 * 1000).toISOString(); // 18:00

    const intersectionInput = {
      principalIds: [user2Id],
      windowStart,
      windowEnd,
      durationMinutes: 60,
    };
    for (const [name, overrides] of [
      ['empty window', { windowEnd: windowStart }],
      ['reversed window', { windowEnd: new Date(tomorrow.getTime() - 1).toISOString() }],
      [
        'window longer than 31 days',
        { windowEnd: new Date(tomorrow.getTime() + 31 * 24 * 3600 * 1000 + 1).toISOString() },
      ],
      ['more than 50 principals', { principalIds: Array<string>(51).fill(user2Id) }],
      ['duration longer than 31 days', { durationMinutes: 31 * 24 * 60 + 1 }],
    ] as const) {
      const invalid = await client2.call('/api/v1/availability/intersection', {
        method: 'POST',
        body: { ...intersectionInput, ...overrides },
      });
      check(`M6-03: rejects ${name}`, invalid.status === 422, JSON.stringify(invalid.body));
    }

    const workingDayStart = new Date(tomorrow);
    workingDayStart.setUTCHours(0);
    const workingDayEnd = new Date(workingDayStart.getTime() + 24 * 3600 * 1000);
    const workingHoursRes = await client2.call('/api/v1/availability/intersection', {
      method: 'POST',
      body: {
        ...intersectionInput,
        windowStart: workingDayStart.toISOString(),
        windowEnd: workingDayEnd.toISOString(),
      },
    });
    const workingSlots =
      (nested(workingHoursRes.body, ['availableSlots']) as {
        startAt: string;
        endAt: string;
      }[]) ?? [];
    check(
      'M6-03: default UTC working hours exclude off-hours and busy intervals',
      workingHoursRes.status === 200 &&
        workingSlots.length === 12 &&
        workingSlots[0]?.startAt === windowStart &&
        workingSlots.at(-1)?.endAt === windowEnd &&
        workingSlots.every(
          (slot) =>
            Date.parse(slot.startAt) >= Date.parse(windowStart) &&
            Date.parse(slot.endAt) <= Date.parse(windowEnd) &&
            (Date.parse(slot.endAt) <= Date.parse(user2BusyStart) ||
              Date.parse(slot.startAt) >= Date.parse(user2BusyEnd)),
        ),
      JSON.stringify(workingHoursRes.body),
    );

    const maxWindowRes = await client2.call('/api/v1/availability/intersection', {
      method: 'POST',
      body: {
        ...intersectionInput,
        windowEnd: new Date(tomorrow.getTime() + 31 * 24 * 3600 * 1000).toISOString(),
        durationMinutes: 31 * 24 * 60,
        workingHoursOnly: false,
      },
    });
    check(
      'M6-03: accepts exactly 31 days and returns no slot when busy time prevents a fit',
      maxWindowRes.status === 200 &&
        Array.isArray(nested(maxWindowRes.body, ['availableSlots'])) &&
        (nested(maxWindowRes.body, ['availableSlots']) as unknown[]).length === 0,
      JSON.stringify(maxWindowRes.body),
    );

    const windowRes = await client2.call('/api/v1/availability/window', {
      method: 'POST',
      body: { principalIds: [user2Id], startAt: windowStart, endAt: windowEnd },
    });
    const windowItems = (nested(windowRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    check(
      'M6-01: owner can query own availability',
      windowRes.status === 200 &&
        windowItems.some((w) => w.principalId === user2Id && w.status === 'busy'),
    );
    check(
      'M6-01: projection omits private details',
      windowItems.every((w) => !('title' in w) && !('description' in w) && !('notes' in w)),
    );
    const foreignWindow = await client2.call('/api/v1/availability/window', {
      method: 'POST',
      body: { principalIds: [user1Id, user2Id], startAt: windowStart, endAt: windowEnd },
    });
    check(
      'M6-01: cross-user availability is denied',
      foreignWindow.status === 403,
      JSON.stringify(foreignWindow.body),
    );
    const foreignIntersection = await client2.call('/api/v1/availability/intersection', {
      method: 'POST',
      body: {
        principalIds: [user1Id, user2Id],
        windowStart,
        windowEnd,
        durationMinutes: 60,
        workingHoursOnly: false,
      },
    });
    check(
      'M6-03: cross-user intersection is denied',
      foreignIntersection.status === 403,
      JSON.stringify(foreignIntersection.body),
    );
    const intersectionRes = await client2.call('/api/v1/availability/intersection', {
      method: 'POST',
      body: {
        principalIds: [user2Id],
        windowStart,
        windowEnd,
        durationMinutes: 60,
        workingHoursOnly: false,
      },
    });
    const slots =
      (nested(intersectionRes.body, ['availableSlots']) as { startAt: string; endAt: string }[]) ??
      [];
    check(
      'M6-03: own availability intersection finds slots',
      intersectionRes.status === 200 && slots.length > 0,
    );
    const chosenSlot = slots[0];
    check(
      'M6-03: candidate slot selected for proposal',
      Boolean(chosenSlot?.startAt && chosenSlot?.endAt),
    );

    // M6-05: Missing constraints return clarification without reading unshared availability
    const clarifyRes = await client2.call('/api/v1/events/coordinate', {
      method: 'POST',
      body: {
        prompt: '帮我安排一次具身智能讨论会',
        participantIds: [user1Id, user2Id],
        defaultTimezone: 'Asia/Shanghai',
      },
    });
    check(
      'M6-05: missing constraints return needs_clarification without querying unshared availability',
      clarifyRes.status === 200 &&
        nested(clarifyRes.body, ['status']) === 'needs_clarification' &&
        nested(clarifyRes.body, ['externalCalendarsModified']) === false &&
        Array.isArray(nested(clarifyRes.body, ['missingConstraints'])) &&
        (nested(clarifyRes.body, ['missingConstraints']) as unknown[]).length >= 2,
      JSON.stringify(clarifyRes.body),
    );

    const deniedCoordRes = await client2.call('/api/v1/events/coordinate', {
      method: 'POST',
      body: {
        prompt: '明天约60分钟讨论',
        participantIds: [user1Id, user2Id],
        defaultTimezone: 'UTC',
        overrides: {
          windowStart,
          windowEnd,
          durationMinutes: 60,
          workingHoursOnly: false,
        },
      },
    });
    check(
      'M6-05: AI coordination denies unshared cross-user availability',
      deniedCoordRes.status === 403,
      JSON.stringify(deniedCoordRes.body),
    );

    // =========================================================================
    // M6-01R: Purpose-bound availability sharing (grant, direction, revocation)
    // =========================================================================
    const shareExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const shareRes = await client1.call('/api/v1/availability/shares', {
      method: 'POST',
      body: { granteePrincipalId: user2Id, expiresAt: shareExpiresAt },
    });
    const shareId = String(nested(shareRes.body, ['id']));
    check(
      'M6-01R: owner creates availability share for another principal',
      shareRes.status === 200 && Boolean(shareId),
      JSON.stringify(shareRes.body),
    );

    const shareListRes = await client2.call('/api/v1/availability/shares');
    const receivedShares = (nested(shareListRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    check(
      'M6-01R: grantee sees the received share',
      shareListRes.status === 200 &&
        receivedShares.some((s) => s.id === shareId && s.direction === 'received'),
      JSON.stringify(shareListRes.body),
    );

    const reverseWindow = await client1.call('/api/v1/availability/window', {
      method: 'POST',
      body: { principalIds: [user2Id], startAt: windowStart, endAt: windowEnd },
    });
    check(
      'M6-01R: share is directional and does not leak the other way',
      reverseWindow.status === 403,
      JSON.stringify(reverseWindow.body),
    );

    const sharedWindow = await client2.call('/api/v1/availability/window', {
      method: 'POST',
      body: { principalIds: [user1Id, user2Id], startAt: windowStart, endAt: windowEnd },
    });
    const sharedItems = (nested(sharedWindow.body, ['data']) as Record<string, unknown>[]) ?? [];
    check(
      'M6-01R: granted principal may read the busy/free projection',
      sharedWindow.status === 200 &&
        sharedItems.some((w) => w.principalId === user1Id && w.status === 'busy') &&
        sharedItems.some((w) => w.principalId === user2Id && w.status === 'busy'),
      JSON.stringify(sharedWindow.body),
    );
    check(
      'M6-01R: shared projection still omits private details',
      sharedItems.every((w) => !('title' in w) && !('description' in w) && !('notes' in w)),
    );

    const sharedIntersection = await client2.call('/api/v1/availability/intersection', {
      method: 'POST',
      body: {
        principalIds: [user1Id, user2Id],
        windowStart,
        windowEnd,
        durationMinutes: 60,
        workingHoursOnly: false,
      },
    });
    const sharedSlots =
      (nested(sharedIntersection.body, ['availableSlots']) as {
        startAt: string;
        endAt: string;
      }[]) ?? [];
    check(
      'M6-03: multi-party intersection works once the share is granted',
      sharedIntersection.status === 200 && sharedSlots.length > 0,
      JSON.stringify(sharedIntersection.body),
    );
    const sharedSlot = sharedSlots[0];
    check(
      'M6-03: multi-party candidate slot selected for proposal',
      Boolean(sharedSlot?.startAt && sharedSlot?.endAt),
    );

    const aiCoordRes = await client2.call('/api/v1/events/coordinate', {
      method: 'POST',
      body: {
        prompt: '安排60分钟具身智能组会',
        participantIds: [user1Id, user2Id],
        defaultTimezone: 'UTC',
        overrides: {
          windowStart,
          windowEnd,
          durationMinutes: 60,
          workingHoursOnly: false,
        },
        maxCandidates: 5,
      },
    });
    const aiCandidates =
      (nested(aiCoordRes.body, ['candidates']) as { startAt: string; endAt: string }[]) ?? [];
    check(
      'M6-05: AI coordination extracts constraints and solves authorized candidates without modifying calendars',
      aiCoordRes.status === 200 &&
        nested(aiCoordRes.body, ['status']) === 'candidates_ready' &&
        nested(aiCoordRes.body, ['mock']) === true &&
        nested(aiCoordRes.body, ['externalCalendarsModified']) === false &&
        aiCandidates.length > 0 &&
        aiCandidates.every(
          (slot) =>
            (Date.parse(slot.endAt) <= Date.parse(user1BusyStart) ||
              Date.parse(slot.startAt) >= Date.parse(user1BusyEnd)) &&
            (Date.parse(slot.endAt) <= Date.parse(user2BusyStart) ||
              Date.parse(slot.startAt) >= Date.parse(user2BusyEnd)),
        ),
      JSON.stringify(aiCoordRes.body),
    );

    // =========================================================================
    // M6-04: Event Creation, Time Proposal, and Multi-party Confirmation
    // =========================================================================
    // Step 1: Create draft event tied to relationship space
    const eventDraftRes = await client2.call('/api/v1/events', {
      method: 'POST',
      body: {
        title: '具身智能课题实验初次研讨会',
        description: '讨论科研实验方案细节与阶段产出',
        location: '东区大楼三层302会议室',
        timezone: 'Asia/Shanghai',
        relationshipId,
        attendeePrincipalIds: [user1Id],
      },
    });
    const eventId = String(nested(eventDraftRes.body, ['id']));
    check(
      'M6-04: event draft created with status draft',
      eventDraftRes.status === 201 && nested(eventDraftRes.body, ['status']) === 'draft',
      JSON.stringify(eventDraftRes.body),
    );

    // Step 2: Propose event time using calculated intersection slot
    const proposalRes = await client2.call(`/api/v1/events/${eventId}/proposals`, {
      method: 'POST',
      body: {
        startAt: sharedSlot?.startAt ?? chosenSlot?.startAt,
        endAt: sharedSlot?.endAt ?? chosenSlot?.endAt,
        timezone: 'Asia/Shanghai',
        expectedVersion: 1,
      },
    });
    check(
      'M6-04: propose time transitions event to pending_confirmation',
      proposalRes.status === 200 && nested(proposalRes.body, ['status']) === 'pending_confirmation',
      JSON.stringify(proposalRes.body),
    );

    // Step 3: User One inspects my events and sees pending invitation
    const user1EventsRes = await client1.call('/api/v1/events/me');
    const user1Events = (nested(user1EventsRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    const targetEvent = user1Events.find((e) => e.id === eventId);
    check(
      'M6-04: invited attendee lists event in pending confirmation',
      Boolean(targetEvent && targetEvent.status === 'pending_confirmation'),
    );

    // Step 4: User One accepts proposal
    const acceptEventRes = await client1.call(`/api/v1/events/${eventId}/responses`, {
      method: 'POST',
      body: {
        response: 'accepted',
        expectedVersion: nested(proposalRes.body, ['version']),
      },
    });
    check(
      'M6-04: all participants accept atomically confirms the event',
      acceptEventRes.status === 200 && nested(acceptEventRes.body, ['status']) === 'confirmed',
      JSON.stringify(acceptEventRes.body),
    );

    // Step 5: Read final event details
    const finalEventRes = await client1.call(`/api/v1/events/${eventId}`);
    check(
      'M6-04: confirmed event has confirmed status and participants record',
      finalEventRes.status === 200 && nested(finalEventRes.body, ['status']) === 'confirmed',
    );

    // Step 6: Cancel event
    const cancelRes = await client2.call(`/api/v1/events/${eventId}/cancel`, {
      method: 'POST',
      body: { reason: '课题组临时调整' },
    });
    check(
      'M6-04: participant cancels event',
      cancelRes.status === 200 && nested(cancelRes.body, ['status']) === 'cancelled',
    );

    // Step 7: Revoke the availability share and confirm the access is withdrawn
    const revokeShareRes = await client1.call(`/api/v1/availability/shares/${shareId}`, {
      method: 'DELETE',
    });
    check(
      'M6-01R: owner revokes the availability share',
      revokeShareRes.status === 200 && nested(revokeShareRes.body, ['revoked']) === true,
      JSON.stringify(revokeShareRes.body),
    );

    const revokedWindow = await client2.call('/api/v1/availability/window', {
      method: 'POST',
      body: { principalIds: [user1Id, user2Id], startAt: windowStart, endAt: windowEnd },
    });
    check(
      'M6-01R: revoked share blocks the projection immediately',
      revokedWindow.status === 403,
      JSON.stringify(revokedWindow.body),
    );

    const revokedIntersection = await client2.call('/api/v1/availability/intersection', {
      method: 'POST',
      body: {
        principalIds: [user1Id, user2Id],
        windowStart,
        windowEnd,
        durationMinutes: 60,
        workingHoursOnly: false,
      },
    });
    check(
      'M6-03: revoked share blocks multi-party intersection immediately',
      revokedIntersection.status === 403,
      JSON.stringify(revokedIntersection.body),
    );

    const revokedCoord = await client2.call('/api/v1/events/coordinate', {
      method: 'POST',
      body: {
        prompt: '安排60分钟组会',
        participantIds: [user1Id, user2Id],
        defaultTimezone: 'UTC',
        overrides: {
          windowStart,
          windowEnd,
          durationMinutes: 60,
          workingHoursOnly: false,
        },
      },
    });
    check(
      'M6-05: revoked share blocks AI coordination immediately',
      revokedCoord.status === 403,
      JSON.stringify(revokedCoord.body),
    );

    const shareListAfterRes = await client1.call('/api/v1/availability/shares');
    const sharesAfter =
      (nested(shareListAfterRes.body, ['data']) as Record<string, unknown>[]) ?? [];
    check(
      'M6-01R: revoked share is reported as revoked',
      sharesAfter.some((s) => s.id === shareId && s.status === 'revoked'),
      JSON.stringify(shareListAfterRes.body),
    );
  } finally {
    await app.close();
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n${failed} M6 verification checks failed.`);
    process.exit(1);
  } else {
    console.log('\nAll M6 journey verification checks passed cleanly!');
  }
}

main().catch((err) => {
  console.error('Fatal M6 journey error:', err);
  process.exit(1);
});
