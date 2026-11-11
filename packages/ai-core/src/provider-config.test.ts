import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import {
  createAIProvider,
  parseAIProviderConfig,
  type AIProviderConfig,
} from './provider-config.js';

describe('AI provider configuration', () => {
  it('defaults to an explicit mock provider', () => {
    const config = parseAIProviderConfig({});
    expect(config).toMatchObject({
      provider: 'mock',
      model: 'mock-deterministic-v1',
    });
    const provider = createAIProvider(config);
    expect(provider).toBeInstanceOf(MockProvider);
    expect(provider.metadata.mock).toBe(true);
  });

  it('parses a configurable OpenAI-compatible provider', () => {
    const config = parseAIProviderConfig({
      AI_PROVIDER: 'openai_compatible',
      AI_BASE_URL: 'https://ai.example.test/v1',
      AI_API_KEY: 'test-key',
      AI_MODEL: 'test-model',
      AI_TIMEOUT_MS: '2500',
    });
    expect(config).toMatchObject({
      provider: 'openai_compatible',
      baseUrl: 'https://ai.example.test/v1',
      model: 'test-model',
      timeoutMs: 2500,
    });
    const provider = createAIProvider(config, {
      fetch: async () => new Response('{}', { status: 200 }),
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.metadata.mock).toBe(false);
  });

  it('rejects incomplete or unsafe provider configuration without echoing secrets', () => {
    let caught: unknown;
    try {
      parseAIProviderConfig({ AI_PROVIDER: 'openai_compatible', AI_MODEL: 'test-model' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(JSON.stringify(caught)).not.toContain('test-key');

    expect(() =>
      parseAIProviderConfig({
        AI_PROVIDER: 'openai_compatible',
        AI_BASE_URL: 'https://user:password@ai.example.test/v1',
        AI_API_KEY: 'test-key',
        AI_MODEL: 'test-model',
      }),
    ).toThrow();
    expect(() => parseAIProviderConfig({ AI_PROVIDER: 'unknown' })).toThrow();
  });

  it('creates a mock provider with a custom model and text', () => {
    const config: AIProviderConfig = {
      provider: 'mock',
      model: 'mock-custom',
      mockText: '固定文本',
    };
    const provider = createAIProvider(config);
    expect(provider.metadata.model).toBe('mock-custom');
    expect(provider).toBeInstanceOf(MockProvider);
  });
});
