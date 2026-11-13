import { describe, expect, it } from 'vitest';
import { MockProvider, OpenAICompatibleProvider } from '@aven/ai-core';
import { providerForRun } from './run-provider';
const live = new OpenAICompatibleProvider({
  baseUrl: 'https://model.example.test/v1',
  apiKey: 'synthetic-key',
  model: 'test-model',
});
describe('run-bound provider selection', () => {
  it('keeps old Mock jobs local after a live deployment', () => {
    expect(
      providerForRun(live, { provider: 'mock', model: 'mock-deterministic-v1', personal: true })
        .metadata.mock,
    ).toBe(true);
  });
  it('preserves explicit mock fixture providers', () => {
    const mock = new MockProvider({ text: 'fixture' });
    expect(
      providerForRun(mock, { provider: 'mock', model: mock.metadata.model, personal: true }),
    ).toBe(mock);
  });
  it('rejects external organization runs', () => {
    expect(() =>
      providerForRun(live, { provider: 'openai_compatible', model: 'test-model', personal: false }),
    ).toThrow(expect.objectContaining({ code: 'TOOL_SCOPE_DENIED' }));
  });
  it('rejects changed model configurations instead of silently substituting', () => {
    expect(() =>
      providerForRun(live, { provider: 'openai_compatible', model: 'old-model', personal: true }),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }));
  });
  it('allows the explicitly configured personal model', () => {
    expect(
      providerForRun(live, { provider: 'openai_compatible', model: 'test-model', personal: true }),
    ).toBe(live);
  });
});
