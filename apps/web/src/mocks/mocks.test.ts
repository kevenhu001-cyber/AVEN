import { describe, expect, it } from 'vitest';
import { createMockEventStream, mockRequest } from './handlers';

const NO_HEADERS: Record<string, string> = {};

function readSse(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = '';
    const reader = stream.getReader();
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          resolve(text);
          return;
        }
        text += decoder.decode(value, { stream: true });
      }
    })().catch(reject);
  });
}

function createStream(runId: string): ReadableStream<Uint8Array> {
  const stream = createMockEventStream(runId);
  if (!stream) throw new Error('expected a run stream');
  return stream;
}

describe('web mock api layer', () => {
  it('serves the session and plants the CSRF cookie on /auth/me', () => {
    const result = mockRequest('GET', ['auth', 'me'], new URLSearchParams(), undefined, NO_HEADERS);
    expect(result?.kind).toBe('json');
    if (result?.kind !== 'json') return;
    expect(result.status).toBe(200);
    expect(result.headers?.['x-aven-mock']).toBe('1');
    expect(result.headers?.['Set-Cookie']).toContain('aven_csrf=');
    expect((result.body as { user: { email: string } }).user.email).toContain('@');
  });

  it('runs the full turn loop: create, stream, persist to history', async () => {
    const created = mockRequest(
      'POST',
      ['agent', 'turns'],
      new URLSearchParams(),
      { input: '帮我核对界面能力' },
      {
        'idempotency-key': 'test-key-1',
      },
    );
    expect(created?.kind).toBe('json');
    if (created?.kind !== 'json') return;
    const turn = created.body as { runId: string; conversationId: string; streamUrl: string };
    expect(turn.streamUrl).toBe(`/api/v1/agent/runs/${turn.runId}/events`);

    const events = mockRequest(
      'GET',
      ['agent', 'runs', turn.runId, 'events'],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    expect(events?.kind).toBe('sse');
    if (events?.kind !== 'sse') return;
    const raw = await readSse(createStream(events.runId));
    expect(raw).toContain('event: turn.started');
    expect(raw).toContain('【模拟回复】');
    expect(raw).toContain('event: turn.completed');

    const run = mockRequest(
      'GET',
      ['agent', 'runs', turn.runId],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    if (run?.kind === 'json') {
      expect((run.body as { status: string }).status).toBe('completed');
    }

    const messages = mockRequest(
      'GET',
      ['agent', 'conversations', turn.conversationId, 'messages'],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    if (messages?.kind !== 'json') throw new Error('expected json');
    const feed = messages.body as {
      data: Array<{ body: string; derivedFromRunId: string | null }>;
    };
    expect(feed.data[0]?.body).toBe('帮我核对界面能力');
    expect(feed.data.at(-1)?.body).toContain('【模拟回复】');
    expect(feed.data.at(-1)?.derivedFromRunId).toBe(turn.runId);

    const conversations = mockRequest(
      'GET',
      ['agent', 'conversations'],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    if (conversations?.kind !== 'json') throw new Error('expected json');
    const list = conversations.body as { data: Array<{ id: string; title: string }> };
    expect(
      list.data.some(
        (item) => item.id === turn.conversationId && item.title === '帮我核对界面能力',
      ),
    ).toBe(true);

    // Same idempotency key replays the same turn response instead of creating a run.
    const replay = mockRequest(
      'POST',
      ['agent', 'turns'],
      new URLSearchParams(),
      { input: '帮我核对界面能力' },
      {
        'idempotency-key': 'test-key-1',
      },
    );
    if (replay?.kind !== 'json') throw new Error('expected json');
    expect((replay.body as { runId: string }).runId).toBe(turn.runId);
  });

  it('supports cancellation with a terminal cancelled event and no history entry', async () => {
    const created = mockRequest(
      'POST',
      ['agent', 'turns'],
      new URLSearchParams(),
      { input: '取消我' },
      {
        'idempotency-key': 'test-key-cancel',
      },
    );
    if (created?.kind !== 'json') throw new Error('expected json');
    const turn = created.body as { runId: string; conversationId: string };

    const cancel = mockRequest(
      'POST',
      ['agent', 'runs', turn.runId, 'cancel'],
      new URLSearchParams(),
      {},
      NO_HEADERS,
    );
    if (cancel?.kind !== 'json') throw new Error('expected json');
    expect((cancel.body as { status: string }).status).toBe('cancelling');

    const events = mockRequest(
      'GET',
      ['agent', 'runs', turn.runId, 'events'],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    if (events?.kind !== 'sse') throw new Error('expected sse');
    const raw = await readSse(createStream(events.runId));
    expect(raw).toContain('event: turn.cancelled');
    expect(raw).not.toContain('event: turn.completed');

    const messages = mockRequest(
      'GET',
      ['agent', 'conversations', turn.conversationId, 'messages'],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    if (messages?.kind !== 'json') throw new Error('expected json');
    const feed = messages.body as { data: Array<{ body: string }> };
    expect(feed.data.filter((message) => message.body.includes('【模拟回复】'))).toHaveLength(0);
  });

  it('covers notifications, memories and plugin catalog with contract-valid shapes', () => {
    const notifications = mockRequest(
      'GET',
      ['notifications'],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    if (notifications?.kind !== 'json') throw new Error('expected json');
    expect((notifications.body as { unreadCount: number }).unreadCount).toBeGreaterThan(0);

    const memories = mockRequest('GET', ['memories'], new URLSearchParams(), undefined, NO_HEADERS);
    if (memories?.kind !== 'json') throw new Error('expected json');
    expect((memories.body as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const catalog = mockRequest('GET', ['plugins'], new URLSearchParams(), undefined, NO_HEADERS);
    if (catalog?.kind !== 'json') throw new Error('expected json');
    const plugins = catalog.body as { plugins: Array<{ id: string }>; total: number };
    expect(plugins.total).toBe(plugins.plugins.length);

    const connectors = mockRequest(
      'GET',
      ['open-connector'],
      new URLSearchParams(),
      undefined,
      NO_HEADERS,
    );
    if (connectors?.kind !== 'json') throw new Error('expected json');
    expect(Array.isArray(connectors.body)).toBe(true);
  });

  it('returns no route for uncovered endpoints such as admin or health', () => {
    expect(
      mockRequest('GET', ['admin', 'config'], new URLSearchParams(), undefined, NO_HEADERS),
    ).toBeUndefined();
    expect(
      mockRequest('GET', ['health', 'live'], new URLSearchParams(), undefined, NO_HEADERS),
    ).toBeUndefined();
  });
});
