import { z } from 'zod';
import { AIError, type AIErrorCode } from './errors.js';

export const AIMessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export const AIMessageSchema = z
  .object({
    role: AIMessageRoleSchema,
    content: z.string().min(1).max(20000),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export const AIMessagesSchema = z.array(AIMessageSchema).min(1).max(50);

export const AIPurposeSchema = z.enum([
  'general',
  'intent_extraction',
  'classification',
  'memory_organization',
  'explanation',
  'embedding',
]);

export const AIProviderKindSchema = z.enum(['mock', 'openai_compatible']);

export type AIMessage = z.infer<typeof AIMessageSchema>;
export type AIPurpose = z.infer<typeof AIPurposeSchema>;
export type AIProviderKind = z.infer<typeof AIProviderKindSchema>;
export type AIFinishReason = 'stop' | 'length' | 'content_filter' | 'unknown';

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export type AIProviderMetadata = {
  provider: AIProviderKind;
  model: string;
  mock: boolean;
};

export type GenerateTextInput = {
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  purpose?: AIPurpose;
  signal?: AbortSignal;
};

export type GenerateTextResult = AIProviderMetadata & {
  text: string;
  usage: AIUsage;
  finishReason: AIFinishReason;
};

export type GenerateObjectInput<T> = GenerateTextInput & {
  schema: z.ZodType<T>;
  schemaName?: string;
  mockValue?: T;
};

export type GenerateObjectResult<T> = AIProviderMetadata & {
  value: T;
  usage: AIUsage;
};

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done'; usage: AIUsage; finishReason: AIFinishReason }
  | {
      type: 'error';
      error: { code: AIErrorCode; message: string; retryable: boolean };
    };

export type StreamTextInput = GenerateTextInput;

export type GenerateEmbeddingInput = {
  values: string[];
  model?: string;
  dimensions?: number;
  purpose?: AIPurpose;
  signal?: AbortSignal;
};

export type GenerateEmbeddingResult = AIProviderMetadata & {
  embeddings: number[][];
  usage: AIUsage;
};

export interface AIProvider {
  readonly metadata: AIProviderMetadata;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  generateObject<T>(input: GenerateObjectInput<T>): Promise<GenerateObjectResult<T>>;
  streamText(input: StreamTextInput): AsyncIterable<StreamEvent>;
  generateEmbedding(input: GenerateEmbeddingInput): Promise<GenerateEmbeddingResult>;
}

export function parseMessages(value: unknown): AIMessage[] {
  const result = AIMessagesSchema.safeParse(value);
  if (!result.success) {
    throw new AIError('PROVIDER_INVALID_REQUEST', 'Invalid AI messages.', {
      details: {
        fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')))],
      },
    });
  }
  return result.data;
}

export function parseGenerationOptions(input: { temperature?: number; maxTokens?: number }): {
  temperature: number;
  maxTokens: number;
} {
  const temperature = input.temperature ?? 0.2;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new AIError('PROVIDER_INVALID_REQUEST', 'Invalid AI temperature.');
  }
  const maxTokens = input.maxTokens ?? 1024;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32000) {
    throw new AIError('PROVIDER_INVALID_REQUEST', 'Invalid AI max tokens.');
  }
  return { temperature, maxTokens };
}

export function parseEmbeddingValues(value: unknown): string[] {
  const result = z.array(z.string().min(1).max(20000)).min(1).max(64).safeParse(value);
  if (!result.success) {
    throw new AIError('PROVIDER_INVALID_REQUEST', 'Invalid embedding input.');
  }
  return result.data;
}

export function parseDimensions(value: number | undefined): number {
  const dimensions = value ?? 16;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 3072) {
    throw new AIError('PROVIDER_INVALID_REQUEST', 'Invalid embedding dimensions.');
  }
  return dimensions;
}

export function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function messageTokens(messages: readonly AIMessage[]): number {
  return messages.reduce((total, message) => total + approximateTokens(message.content), 0);
}

export function usageFor(inputTokens: number, outputText: string, costUsd?: number): AIUsage {
  const outputTokens = outputText.length > 0 ? approximateTokens(outputText) : 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}
