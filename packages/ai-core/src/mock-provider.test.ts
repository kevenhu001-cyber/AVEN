import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockProvider } from './mock-provider.js';
import type { StreamEvent } from './provider.js';

const messages = [{ role: 'user' as const, content: '你好' }];

describe('MockProvider', () => {
  it('is explicitly marked and deterministic', async () => {
    const provider = new MockProvider();
    expect(provider.metadata).toEqual({
      provider: 'mock',
      model: 'mock-deterministic-v1',
      mock: true,
    });
    const first = await provider.generateText({ messages });
    const second = await provider.generateText({ messages });
    expect(first.text).toBe(second.text);
    expect(first.mock).toBe(true);
    expect(first.usage.totalTokens).toBeGreaterThan(0);
  });

  it('requires and validates structured mock values', async () => {
    const schema = z.object({ title: z.string().min(1) }).strict();
    const provider = new MockProvider();
    await expect(provider.generateObject({ messages, schema })).rejects.toMatchObject({
      code: 'MOCK_RESULT_REQUIRED',
    });
    const result = await provider.generateObject({
      messages,
      schema,
      mockValue: { title: '机器人' },
    });
    expect(result.value.title).toBe('机器人');
    await expect(
      provider.generateObject({ messages, schema, mockValue: { title: '' } }),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_OUTPUT' });
  });

  it('streams deterministic text and a done event', async () => {
    const provider = new MockProvider({ text: '这是流式输出的确定性文本。' });
    const events: StreamEvent[] = [];
    for await (const event of provider.streamText({ messages })) events.push(event);
    expect(events.at(-1)?.type).toBe('done');
    expect(
      events.flatMap((event) => (event.type === 'text_delta' ? [event.text] : [])).join(''),
    ).toBe('这是流式输出的确定性文本。');
  });

  it('produces deterministic embeddings with the requested dimensions', async () => {
    const provider = new MockProvider();
    const first = await provider.generateEmbedding({ values: ['a', 'b'], dimensions: 8 });
    const second = await provider.generateEmbedding({ values: ['a', 'b'], dimensions: 8 });
    expect(first.embeddings).toEqual(second.embeddings);
    expect(first.embeddings[0]).toHaveLength(8);
    expect(first.embeddings[0]).not.toEqual(first.embeddings[1]);
  });

  it('rejects invalid provider input', async () => {
    const provider = new MockProvider();
    await expect(provider.generateText({ messages: [] })).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_REQUEST',
    });
    await expect(provider.generateText({ messages, temperature: 3 })).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_REQUEST',
    });
    await expect(provider.generateEmbedding({ values: [] })).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_REQUEST',
    });
  });

  it('honors an already aborted signal', async () => {
    const provider = new MockProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.generateText({ messages, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' });
  });
});
