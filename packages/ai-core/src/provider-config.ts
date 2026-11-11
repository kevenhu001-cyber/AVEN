import { z } from 'zod';
import { AIError } from './errors.js';
import { MockProvider } from './mock-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import type { AIProvider } from './provider.js';

const BaseUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}, 'Expected an HTTP(S) base URL without credentials, query, or hash.');

const MockProviderConfigSchema = z
  .object({
    provider: z.literal('mock'),
    model: z.string().trim().min(1).max(120).default('mock-deterministic-v1'),
    mockText: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const OpenAICompatibleConfigSchema = z
  .object({
    provider: z.literal('openai_compatible'),
    baseUrl: BaseUrlSchema,
    apiKey: z.string().min(1).max(500),
    model: z.string().trim().min(1).max(120),
    timeoutMs: z.coerce.number().int().min(1000).max(120000).default(15000),
  })
  .strict();

export const AIProviderConfigSchema = z.discriminatedUnion('provider', [
  MockProviderConfigSchema,
  OpenAICompatibleConfigSchema,
]);

export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>;

export type CreateAIProviderOptions = {
  fetch?: typeof fetch;
};

export function parseAIProviderConfig(input: Record<string, unknown>): AIProviderConfig {
  const provider = input.AI_PROVIDER ?? 'mock';
  const raw =
    provider === 'mock'
      ? {
          provider: 'mock',
          model:
            typeof input.AI_MODEL === 'string' && input.AI_MODEL.trim().length > 0
              ? input.AI_MODEL
              : 'mock-deterministic-v1',
          ...(typeof input.AI_MOCK_TEXT === 'string' && input.AI_MOCK_TEXT.trim().length > 0
            ? { mockText: input.AI_MOCK_TEXT }
            : {}),
        }
      : provider === 'openai_compatible'
        ? {
            provider: 'openai_compatible',
            baseUrl: input.AI_BASE_URL,
            apiKey: input.AI_API_KEY,
            model: input.AI_MODEL,
            timeoutMs: input.AI_TIMEOUT_MS ?? 15000,
          }
        : { provider };

  const result = AIProviderConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AIError('PROVIDER_NOT_CONFIGURED', 'Invalid AI provider configuration.', {
      details: {
        fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')))],
      },
    });
  }
  return result.data;
}

export function createAIProvider(
  config: AIProviderConfig,
  options: CreateAIProviderOptions = {},
): AIProvider {
  if (config.provider === 'mock') {
    return new MockProvider({
      model: config.model,
      ...(config.mockText === undefined ? {} : { text: config.mockText }),
    });
  }
  return new OpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
