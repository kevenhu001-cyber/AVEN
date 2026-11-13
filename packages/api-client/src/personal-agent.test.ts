import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';
const runId = '8544c04c-dbdc-4a1a-b97a-20ac76ee5966';
const call = { auth: { kind: 'web' as const, csrfToken: 'fresh-csrf' } };
const frame = (type: string, sequence: number, extra = {}, id = sequence) =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ schema_version: 1, run_id: runId, sequence, timestamp: '2026-11-12T00:00:00.000Z', ...extra })}\n\n`;
const response = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream' } });
async function collect(events: AsyncIterable<unknown>) {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
}
describe('personal Web transport', () => {
  it('rejects a mobile bearer returned to the Web login flow', async () => {
    const timestamp = '2026-11-12T00:00:00.000Z';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        user: {
          id: runId,
          displayName: 'Synthetic',
          email: 'fixture@example.test',
          emailVerified: true,
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
        },
        session: {
          id: runId,
          client: 'web',
          userAgent: null,
          createdAt: timestamp,
          lastSeenAt: timestamp,
          expiresAt: timestamp,
          revokedAt: null,
          current: true,
        },
        sessionToken: 'must-never-reach-web-state',
      }),
    );
    await expect(
      createApiClient({ fetcher }).auth.loginWeb({
        email: 'fixture@example.test',
        password: 'Example-password-2026!',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects a server-provided stream URL outside the validated owned run path', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        runId,
        conversationId: runId,
        status: 'queued',
        streamUrl: 'https://untrusted.example/events',
      }),
    );
    await expect(
      createApiClient({ fetcher }).agent.createTurn({ input: 'synthetic input' }, 'same-key', call),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('forces the Web login flow and never retries rejected credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 401 }));
    await expect(
      createApiClient({ fetcher }).auth.loginWeb({
        email: 'fixture@example.test',
        password: 'Example-password-2026!',
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ client: 'web' });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });
  it('accepts empty logout and uses each call’s current CSRF token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const client = createApiClient({ fetcher });
    await client.auth.logout(call);
    await client.auth.logout({ auth: { kind: 'web', csrfToken: 'rotated-csrf' } });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'fresh-csrf' });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'rotated-csrf' });
  });
  it('rejects a Web write without CSRF before fetching', () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createApiClient({ fetcher }).auth.logout({ auth: { kind: 'web' } })).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('Agent SSE validation', () => {
  it('uses the owned run path, current credentials and cursor; deduplicates replay', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(
          frame('message.delta', 1, { text: 'old' }) +
            frame('message.delta', 2, { text: 'new' }) +
            frame('turn.completed', 3),
        ),
      );
    const events = await collect(createApiClient({ fetcher }).agent.events(runId, 1, call));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ text: 'new', sequence: 2 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/agent/runs/${runId}/events`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Last-Event-ID': '1' },
    });
  });
  it.each([
    frame('message.delta', 1, {
      run_id: 'a4ba36a4-b6b1-4dd9-98d1-b31f3f19bcba',
      text: 'wrong owner',
    }),
    frame('message.delta', 1, { text: 'bad sequence' }, 2),
    frame('message.delta', 1),
    frame('turn.completed', 2),
    'event: message.delta\ndata: invalid-json\n\n',
  ])('rejects malformed or cross-run events', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    await expect(
      collect(createApiClient({ fetcher }).agent.events(runId, 0, call)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not report a truncated stream as complete or retry it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(frame('message.delta', 1, { text: 'partial' })));
    await expect(
      collect(createApiClient({ fetcher }).agent.events(runId, 0, call)),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves session failure without forwarding private upstream text', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ detail: 'private' }, { status: 401 }));
    await expect(
      collect(createApiClient({ fetcher }).agent.events(runId, 0, call)),
    ).rejects.toMatchObject({ status: 401, message: 'HTTP_ERROR' });
  });
  it('does not dispatch an already-aborted stream', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      collect(
        createApiClient({ fetcher }).agent.events(runId, 0, {
          ...call,
          signal: AbortSignal.abort(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('browser fetch invocation', () => {
  it('does not bind the fetch function to a transport object', async () => {
    const fetcher = function (this: unknown): Promise<Response> {
      expect(this).toBeUndefined();
      return Promise.resolve(response(frame('turn.completed', 1)));
    } as typeof fetch;
    await expect(
      collect(createApiClient({ fetcher }).agent.events(runId, 0, call)),
    ).resolves.toHaveLength(1);
  });
});

describe('runtime metadata', () => {
  it('reads authenticated model mode without returning credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ providerMode: 'live', externalActions: false }));
    const runtime = await createApiClient({ fetcher }).agent.runtime(call);
    expect(runtime).toEqual({ providerMode: 'live', externalActions: false });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/agent/runtime');
  });
  it('rejects metadata containing a credential', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          providerMode: 'live',
          externalActions: false,
          apiKey: 'never-return-keys',
        }),
      );
    await expect(createApiClient({ fetcher }).agent.runtime(call)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
