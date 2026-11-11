import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  createApplicationPool,
  createPool,
  withRequestContext,
} from '../packages/database/dist/index.js';
import { parseApiEnvironment } from '../packages/config/dist/env.js';
import { createApiApplication } from '../apps/api/dist/app.js';
import { AppModule } from '../apps/api/dist/app.module.js';
import { MockProvider } from '../packages/ai-core/dist/index.js';
import { processAgentRun } from '../apps/worker/dist/agent.js';
import { createWorkerRuntime } from '../apps/worker/dist/runtime.js';

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

type SseEvent = { id?: string; event: string; data: Record<string, unknown> };
function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    let id: string | undefined;
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('id: ')) id = line.slice(4);
      else if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!event || !data) continue;
    try {
      events.push({
        ...(id === undefined ? {} : { id }),
        event,
        data: JSON.parse(data) as Record<string, unknown>,
      });
    } catch {
      // Ignore malformed frames.
    }
  }
  return events;
}

async function waitForRun(
  client: Client,
  runId: string,
  expectedStatus: string,
  timeoutMs = 5000,
): Promise<{ status: number; body: unknown }> {
  const started = Date.now();
  for (;;) {
    const response = await client.call(`/api/v1/agent/runs/${runId}`);
    if (nested(response.body, ['status']) === expectedStatus) return response;
    if (Date.now() - started > timeoutMs) return response;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

class Client {
  private jar = new Map<string, string>();
  csrf: string | undefined;

  constructor(private readonly baseUrl: string) {}

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
    const headers = new Headers(options.headers);
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

  async stream(path: string, headers: Record<string, string> = {}): Promise<Response> {
    const requestHeaders = new Headers({ accept: 'text/event-stream', ...headers });
    if (this.jar.size) requestHeaders.set('cookie', this.cookieHeader());
    return fetch(`${this.baseUrl}${path}`, {
      headers: requestHeaders,
      redirect: 'error',
    });
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
    close: async () => undefined,
  });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const migrator = createPool('aven_migrator', { max: 2 });
  const appPool = createApplicationPool({ max: 2 });
  const workerPool = createPool('aven_worker', { max: 2 });
  const userIds: string[] = [];
  const runIds: string[] = [];
  const conversationIds: string[] = [];
  const stamp = Date.now();
  const password = 'Correct Horse Battery Staple 42!';
  const emailA = `agent.a.${stamp}@example.test`;
  const emailB = `agent.b.${stamp}@example.test`;
  const clientA = new Client(baseUrl);
  const clientB = new Client(baseUrl);
  const workerLogs: unknown[] = [];
  const workerLog = (entry: unknown): void => {
    workerLogs.push(entry);
  };

  try {
    const userA = await clientA.register(emailA, 'Agent 用户 A', password);
    const userB = await clientB.register(emailB, 'Agent 用户 B', password);
    userIds.push(userA, userB);
    check('agent users register and log in', Boolean(userA && userB));

    const memory = await clientA.call('/api/v1/memories', {
      method: 'POST',
      body: {
        kind: 'skill',
        title: '机器人控制',
        content: '四足机器人步态控制与 ROS 2 仿真',
        allowedUses: ['self_ai'],
      },
    });
    const memoryId = String(nested(memory.body, ['id']));
    check('agent source memory is created', memory.status === 201 && Boolean(memoryId));

    const turn = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-turn-1' },
      body: { input: '请总结我的机器人控制技能' },
    });
    check('agent turn creation returns 201', turn.status === 201, JSON.stringify(turn.body));
    const runId = String(nested(turn.body, ['runId']));
    const conversationId = String(nested(turn.body, ['conversationId']));
    runIds.push(runId);
    conversationIds.push(conversationId);
    check(
      'agent turn returns queued status and stream URL',
      nested(turn.body, ['status']) === 'queued' &&
        String(nested(turn.body, ['streamUrl'])).endsWith(`/agent/runs/${runId}/events`),
    );

    const replay = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-turn-1' },
      body: { input: '请总结我的机器人控制技能' },
    });
    check(
      'agent turn idempotency replays the same run',
      replay.status === 201 && nested(replay.body, ['runId']) === runId,
    );
    const conflict = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-turn-1' },
      body: { input: '不同的输入' },
    });
    check(
      'agent turn idempotency rejects a different request',
      conflict.status === 409 &&
        nested(conflict.body, ['error', 'code']) === 'IDEMPOTENCY_CONFLICT',
    );
    const missingKey = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      body: { input: '缺少幂等键' },
    });
    check('agent turn requires an idempotency key', missingKey.status === 422);

    const queued = await clientA.call(`/api/v1/agent/runs/${runId}`);
    check(
      'agent run is readable while queued',
      queued.status === 200 && nested(queued.body, ['status']) === 'queued',
    );
    const otherRun = await clientB.call(`/api/v1/agent/runs/${runId}`);
    check('another user cannot read the agent run', otherRun.status === 404);
    const otherEvents = await clientB.stream(`/api/v1/agent/runs/${runId}/events`);
    check('another user cannot subscribe to agent events', otherEvents.status === 404);
    const otherCancel = await clientB.call(`/api/v1/agent/runs/${runId}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-cancel-other' },
    });
    check('another user cannot cancel the agent run', otherCancel.status === 404);

    const runtime = createWorkerRuntime(workerLog);
    await runtime.start();
    let completed: { status: number; body: unknown };
    try {
      completed = await waitForRun(clientA, runId, 'completed');
    } finally {
      await runtime.close();
    }
    check(
      'worker completes the agent run through the outbox queue',
      completed.status === 200 && nested(completed.body, ['status']) === 'completed',
      JSON.stringify(completed.body),
    );
    check(
      'agent run reaches completed status',
      completed.status === 200 &&
        nested(completed.body, ['status']) === 'completed' &&
        nested(completed.body, ['outputSummary']) === 'mock_response' &&
        typeof nested(completed.body, ['completedAt']) === 'string',
    );

    const eventsResponse = await clientA.stream(`/api/v1/agent/runs/${runId}/events`);
    const eventsText = await eventsResponse.text();
    const events = parseSse(eventsText);
    check(
      'agent SSE returns event stream content type',
      eventsResponse.status === 200 &&
        String(eventsResponse.headers.get('content-type')).includes('text/event-stream'),
    );
    const eventNames = events.map((event) => event.event);
    check(
      'agent SSE persists the expected event sequence',
      eventNames.includes('turn.started') &&
        eventNames.includes('tool.started') &&
        eventNames.includes('tool.completed') &&
        eventNames.includes('message.delta') &&
        eventNames.at(-1) === 'turn.completed',
      eventNames.join(','),
    );
    check(
      'agent SSE event ids are monotonic',
      events.every((event, index) => event.id === String(index + 1)),
    );
    check(
      'agent SSE data carries run and sequence envelopes',
      events.every(
        (event) =>
          event.data.run_id === runId &&
          event.data.schema_version === 1 &&
          typeof event.data.sequence === 'number',
      ),
    );
    const deltaText = events
      .filter((event) => event.event === 'message.delta')
      .map((event) => String(event.data.text ?? ''))
      .join('');
    check('agent SSE streams text deltas', deltaText.length > 0);
    check(
      'agent SSE does not expose prompts or memory content',
      !eventsText.includes('You are AVEN') &&
        !eventsText.includes('Authorized personal context') &&
        !eventsText.includes('四足机器人步态控制'),
    );

    const resumed = parseSse(
      await (
        await clientA.stream(`/api/v1/agent/runs/${runId}/events`, {
          'last-event-id': '2',
        })
      ).text(),
    );
    check(
      'agent SSE resumes after Last-Event-ID',
      resumed.length > 0 && resumed.every((event) => Number(event.id) > 2),
    );
    const invalidCursor = await clientA.stream(`/api/v1/agent/runs/${runId}/events`, {
      'last-event-id': 'not-a-number',
    });
    check('agent SSE rejects an invalid cursor', invalidCursor.status === 409);
    const outOfRangeCursor = await clientA.stream(`/api/v1/agent/runs/${runId}/events`, {
      'last-event-id': '9999',
    });
    check('agent SSE rejects an out-of-range cursor', outOfRangeCursor.status === 409);

    const eventRows = await withRequestContext(
      appPool,
      { principalId: userA, userId: userA },
      async (client) =>
        client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM public.agent_run_events WHERE run_id = $1',
          [runId],
        ),
    );
    check('agent events are persisted', eventRows.rows[0]?.count === String(events.length));
    const sourceRows = await withRequestContext(
      appPool,
      { principalId: userA, userId: userA },
      async (client) =>
        client.query<{ source_type: string; source_id: string }>(
          'SELECT source_type, source_id FROM public.agent_run_sources WHERE run_id = $1',
          [runId],
        ),
    );
    check(
      'agent run binds message and memory sources',
      sourceRows.rows.some((row) => row.source_type === 'message') &&
        sourceRows.rows.some(
          (row) => row.source_type === 'memory_item' && row.source_id === memoryId,
        ),
    );
    const assistantMessage = await withRequestContext(
      appPool,
      { principalId: userA, userId: userA },
      async (client) =>
        client.query<{ body: string }>(
          'SELECT body FROM public.messages WHERE derived_from_run_id = $1',
          [runId],
        ),
    );
    check('agent run stores the assistant message', assistantMessage.rows[0]?.body === deltaText);

    const deleteMemory = await clientA.call(`/api/v1/memories/${memoryId}?expectedVersion=1`, {
      method: 'DELETE',
    });
    check('agent source memory can be deleted', deleteMemory.status === 204);
    const invalidated = await clientA.stream(`/api/v1/agent/runs/${runId}/events`);
    check(
      'agent SSE refuses replay after source invalidation',
      invalidated.status === 409 &&
        nested(await invalidated.json(), ['error', 'code']) === 'SOURCE_INVALIDATED',
    );
    const stillCompleted = await clientA.call(`/api/v1/agent/runs/${runId}`);
    check(
      'agent run status remains queryable after source invalidation',
      stillCompleted.status === 200 && nested(stillCompleted.body, ['status']) === 'completed',
    );

    const cancelTurn = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-turn-cancel' },
      body: { input: '取消这个任务' },
    });
    const cancelRunId = String(nested(cancelTurn.body, ['runId']));
    runIds.push(cancelRunId);
    conversationIds.push(String(nested(cancelTurn.body, ['conversationId'])));
    const cancelQueued = await clientA.call(`/api/v1/agent/runs/${cancelRunId}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-cancel-1' },
    });
    check(
      'cancelling a queued run returns accepted',
      cancelQueued.status === 202 && nested(cancelQueued.body, ['status']) === 'cancelled',
    );
    const cancelledRun = await clientA.call(`/api/v1/agent/runs/${cancelRunId}`);
    check(
      'queued run is cancelled immediately',
      cancelledRun.status === 200 && nested(cancelledRun.body, ['status']) === 'cancelled',
    );
    const cancelledEvents = parseSse(
      await (await clientA.stream(`/api/v1/agent/runs/${cancelRunId}/events`)).text(),
    );
    check(
      'cancelled run records a terminal cancellation event',
      cancelledEvents.at(-1)?.event === 'turn.cancelled',
    );
    const skipped = await processAgentRun(workerPool, cancelRunId, new MockProvider(), workerLog);
    check('worker skips an already cancelled run', skipped === 'skipped', String(skipped));
    const cancelAgain = await clientA.call(`/api/v1/agent/runs/${cancelRunId}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-cancel-2' },
    });
    check(
      'cancelling a terminal run returns its current status',
      cancelAgain.status === 200 && nested(cancelAgain.body, ['status']) === 'cancelled',
    );

    const liveTurn = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-turn-live' },
      body: { input: '实时流测试' },
    });
    const liveRunId = String(nested(liveTurn.body, ['runId']));
    runIds.push(liveRunId);
    conversationIds.push(String(nested(liveTurn.body, ['conversationId'])));
    const liveResponse = await clientA.stream(`/api/v1/agent/runs/${liveRunId}/events`);
    check('live agent SSE opens with 200', liveResponse.status === 200);
    const liveProcessing = processAgentRun(workerPool, liveRunId, new MockProvider(), workerLog, {
      deltaDelayMs: 20,
    });
    const liveText = await liveResponse.text();
    const liveResult = await liveProcessing;
    check('live agent run completes', liveResult === 'completed', String(liveResult));
    const liveEvents = parseSse(liveText);
    check(
      'live agent SSE receives persisted events and closes',
      liveEvents.at(-1)?.event === 'turn.completed',
    );

    const cancelRunningTurn = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-turn-running-cancel' },
      body: { input: '运行中取消测试' },
    });
    const runningRunId = String(nested(cancelRunningTurn.body, ['runId']));
    runIds.push(runningRunId);
    conversationIds.push(String(nested(cancelRunningTurn.body, ['conversationId'])));
    const runningProcessing = processAgentRun(
      workerPool,
      runningRunId,
      new MockProvider(),
      workerLog,
      { deltaDelayMs: 500, cancelPollMs: 10 },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cancelRunning = await clientA.call(`/api/v1/agent/runs/${runningRunId}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-cancel-running' },
    });
    const runningResult = await runningProcessing;
    check(
      'cancelling a running run is accepted',
      cancelRunning.status === 202 && nested(cancelRunning.body, ['status']) === 'cancelling',
    );
    check(
      'worker stops a cancelled running run',
      runningResult === 'cancelled',
      String(runningResult),
    );
    const runningStatus = await clientA.call(`/api/v1/agent/runs/${runningRunId}`);
    check(
      'running cancellation reaches cancelled status',
      runningStatus.status === 200 && nested(runningStatus.body, ['status']) === 'cancelled',
    );
    const runningEvents = parseSse(
      await (await clientA.stream(`/api/v1/agent/runs/${runningRunId}/events`)).text(),
    );
    check(
      'running cancellation records a terminal cancellation event',
      runningEvents.at(-1)?.event === 'turn.cancelled',
    );

    const expiredTurn = await clientA.call('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-turn-expired' },
      body: { input: '过期历史测试' },
    });
    const expiredRunId = String(nested(expiredTurn.body, ['runId']));
    runIds.push(expiredRunId);
    conversationIds.push(String(nested(expiredTurn.body, ['conversationId'])));
    await processAgentRun(workerPool, expiredRunId, new MockProvider(), workerLog);
    await migrator.query(
      "UPDATE public.agent_runs SET created_at = now() - interval '25 hours' WHERE id = $1",
      [expiredRunId],
    );
    await migrator.query(
      "UPDATE public.agent_run_events SET expires_at = now() - interval '1 hour' WHERE run_id = $1",
      [expiredRunId],
    );
    const expiredEvents = await clientA.stream(`/api/v1/agent/runs/${expiredRunId}/events`);
    check(
      'agent SSE returns 410 after event history expiry',
      expiredEvents.status === 410 &&
        nested(await expiredEvents.json(), ['error', 'code']) === 'EVENT_HISTORY_EXPIRED',
    );
    const expiredRun = await clientA.call(`/api/v1/agent/runs/${expiredRunId}`);
    check(
      'expired agent run status remains queryable',
      expiredRun.status === 200 && nested(expiredRun.body, ['status']) === 'completed',
    );
    const purgeEvents = await workerPool.query<{ count: number }>(
      'SELECT app.purge_agent_run_events(24) AS count',
    );
    check('agent event maintenance purges expired events', (purgeEvents.rows[0]?.count ?? 0) >= 1);
    const purgedHistory = await clientA.stream(`/api/v1/agent/runs/${expiredRunId}/events`);
    check('agent SSE stays expired after event cleanup', purgedHistory.status === 410);

    check(
      'worker logs do not contain agent content',
      !JSON.stringify(workerLogs).includes('请总结我的机器人控制技能') &&
        !JSON.stringify(workerLogs).includes('四足机器人步态控制'),
    );
  } finally {
    if (runIds.length) {
      await migrator
        .query(
          "DELETE FROM public.outbox_events WHERE aggregate_type = 'agent_run' AND aggregate_id = ANY($1::uuid[])",
          [runIds],
        )
        .catch(() => undefined);
      await migrator
        .query('DELETE FROM public.agent_runs WHERE id = ANY($1::uuid[])', [runIds])
        .catch(() => undefined);
    }
    if (conversationIds.length) {
      await migrator
        .query('DELETE FROM public.conversations WHERE id = ANY($1::uuid[])', [conversationIds])
        .catch(() => undefined);
    }
    if (userIds.length) {
      await migrator
        .query('DELETE FROM public.idempotency_keys WHERE principal_id = ANY($1::uuid[])', [
          userIds,
        ])
        .catch(() => undefined);
      await migrator
        .query(
          'DELETE FROM public.context_field_policies WHERE owner_principal_id = ANY($1::uuid[])',
          [userIds],
        )
        .catch(() => undefined);
      await migrator
        .query('DELETE FROM public.memory_items WHERE owner_principal_id = ANY($1::uuid[])', [
          userIds,
        ])
        .catch(() => undefined);
      await migrator
        .query('DELETE FROM public.principals WHERE id = ANY($1::uuid[])', [userIds])
        .catch(() => undefined);
    }
    await appPool.end().catch(() => undefined);
    await workerPool.end().catch(() => undefined);
    await migrator.end().catch(() => undefined);
    await app.close();
  }

  if (failed) {
    console.error(`\n${failed} agent check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll agent runtime checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Agent verification failed.');
  process.exitCode = 1;
});
