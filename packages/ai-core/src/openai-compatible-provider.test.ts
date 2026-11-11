import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import type { StreamEvent } from './provider.js';

const messages = [{ role: 'user' as const, content: 'hi' }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeProvider(fetchImpl: typeof fetch, timeoutMs = 1000): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://ai.example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    timeoutMs,
    fetch: fetchImpl,
  });
}

describe('OpenAICompatibleProvider', () => {
  it('sends a bounded request and parses text usage', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const provider = makeProvider(async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({
        choices: [{ message: { content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
    });

    const result = await provider.generateText({ messages, temperature: 0.1, maxTokens: 128 });
    expect(result.text).toBe('你好');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
    expect(result.mock).toBe(false);
    expect(capturedUrl).toBe('https://ai.example.test/v1/chat/completions');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'test-model',
      temperature: 0.1,
      max_tokens: 128,
      stream: false,
    });
  });

  it('maps provider HTTP failures without leaking credentials', async () => {
    const cases = [
      [429, 'PROVIDER_RATE_LIMITED', true],
      [401, 'PROVIDER_AUTH_FAILED', false],
      [400, 'PROVIDER_INVALID_REQUEST', false],
      [500, 'PROVIDER_UNAVAILABLE', true],
    ] as const;
    for (const [status, code, retryable] of cases) {
      const provider = makeProvider(async () => jsonResponse({ error: 'private' }, status));
      let caught: unknown;
      try {
        await provider.generateText({ messages });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code, retryable });
      expect(JSON.stringify(caught)).not.toContain('test-key');
      expect(JSON.stringify(caught)).not.toContain('private');
    }
  });

  it('times out and cancels requests', async () => {
    const slowFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const timedOut = makeProvider(slowFetch, 10);
    await expect(timedOut.generateText({ messages })).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });

    const controller = new AbortController();
    const cancelled = makeProvider((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        controller.abort();
      });
    });
    await expect(
      cancelled.generateText({ messages, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' });
  });

  it('validates structured output at runtime', async () => {
    const schema = z.object({ title: z.string().min(1) }).strict();
    const valid = makeProvider(async () =>
      jsonResponse({ choices: [{ message: { content: '{"title":"机器人"}' } }] }),
    );
    await expect(valid.generateObject({ messages, schema })).resolves.toMatchObject({
      value: { title: '机器人' },
    });

    const invalidJson = makeProvider(async () =>
      jsonResponse({ choices: [{ message: { content: 'not-json' } }] }),
    );
    await expect(invalidJson.generateObject({ messages, schema })).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_OUTPUT',
    });

    const invalidSchema = makeProvider(async () =>
      jsonResponse({ choices: [{ message: { content: '{"title":""}' } }] }),
    );
    await expect(invalidSchema.generateObject({ messages, schema })).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_OUTPUT',
    });
  });

  it('parses embeddings and rejects malformed vectors', async () => {
    const valid = makeProvider(async () =>
      jsonResponse({
        data: [{ embedding: [0.1, 0.2] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }),
    );
    const result = await valid.generateEmbedding({ values: ['hello'] });
    expect(result.embeddings).toEqual([[0.1, 0.2]]);

    const invalid = makeProvider(async () => jsonResponse({ data: [] }));
    await expect(invalid.generateEmbedding({ values: ['hello'] })).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_OUTPUT',
    });
  });

  it('streams text deltas and a terminal event', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const provider = makeProvider(
      async () =>
        new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const events: StreamEvent[] = [];
    for await (const event of provider.streamText({ messages })) events.push(event);
    expect(
      events.flatMap((event) => (event.type === 'text_delta' ? [event.text] : [])).join(''),
    ).toBe('你好');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('rejects a truncated stream instead of reporting completion', async () => {
    const provider = makeProvider(
      async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n'),
    );
    const events: StreamEvent[] = [];
    for await (const event of provider.streamText({ messages })) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'PROVIDER_INVALID_OUTPUT' },
    });
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  it('accepts an unterminated DONE line and calculates estimated totals', async () => {
    const provider = makeProvider(
      async () =>
        new Response('data: {"choices":[{"delta":{"content":"A useful answer"}}]}\ndata: [DONE]'),
    );
    const events: StreamEvent[] = [];
    for await (const event of provider.streamText({ messages })) events.push(event);
    const done = events.find((event) => event.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.usage.outputTokens).toBeGreaterThan(0);
      expect(done.usage.totalTokens).toBe(done.usage.inputTokens + done.usage.outputTokens);
    }
  });

  it('uses a usage-only stream event', async () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
      'data: [DONE]',
      '',
    ].join('\n');
    const provider = makeProvider(async () => new Response(stream));
    const events: StreamEvent[] = [];
    for await (const event of provider.streamText({ messages })) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    });
  });

  it('rejects malformed stream events', async () => {
    const provider = makeProvider(async () => new Response('data: {bad json}\ndata: [DONE]\n'));
    const events: StreamEvent[] = [];
    for await (const event of provider.streamText({ messages })) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'PROVIDER_INVALID_OUTPUT' },
    });
  });

  it('times out a stalled stream', async () => {
    const provider = makeProvider(
      async () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      10,
    );
    const events: StreamEvent[] = [];
    for await (const event of provider.streamText({ messages })) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'PROVIDER_TIMEOUT' },
    });
  });

  it('rejects invalid input before calling the provider', async () => {
    let called = false;
    const provider = makeProvider(async () => {
      called = true;
      return jsonResponse({});
    });
    await expect(provider.generateText({ messages: [] })).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_REQUEST',
    });
    expect(called).toBe(false);
  });
});
