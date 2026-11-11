import { AIError } from './errors.js';
import {
  messageTokens,
  parseDimensions,
  parseEmbeddingValues,
  parseGenerationOptions,
  parseMessages,
  usageFor,
  type AIProvider,
  type AIProviderMetadata,
  type GenerateEmbeddingInput,
  type GenerateEmbeddingResult,
  type GenerateObjectInput,
  type GenerateObjectResult,
  type GenerateTextInput,
  type GenerateTextResult,
  type StreamEvent,
  type StreamTextInput,
} from './provider.js';

const defaultMockText = '这是 Mock AI 的确定性回复。';
const defaultStreamText = '这是 Mock AI 的确定性流式回复。';

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicVector(text: string, dimensions: number): number[] {
  let state = hashText(text) || 1;
  return Array.from({ length: dimensions }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AIError('PROVIDER_CANCELLED', 'The AI request was cancelled.');
  }
}

export type MockProviderOptions = {
  model?: string;
  text?: string;
};

export class MockProvider implements AIProvider {
  readonly metadata: AIProviderMetadata;
  private readonly text: string | undefined;

  constructor(options: MockProviderOptions = {}) {
    this.metadata = {
      provider: 'mock',
      model: options.model ?? 'mock-deterministic-v1',
      mock: true,
    };
    this.text = options.text;
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    throwIfAborted(input.signal);
    const messages = parseMessages(input.messages);
    const { maxTokens } = parseGenerationOptions(input);
    const text = Array.from(this.text ?? defaultMockText)
      .slice(0, maxTokens)
      .join('');
    return {
      ...this.metadata,
      text,
      usage: usageFor(messageTokens(messages), text),
      finishReason: 'stop',
    };
  }

  async generateObject<T>(input: GenerateObjectInput<T>): Promise<GenerateObjectResult<T>> {
    throwIfAborted(input.signal);
    const messages = parseMessages(input.messages);
    if (input.mockValue === undefined) {
      throw new AIError(
        'MOCK_RESULT_REQUIRED',
        'MockProvider requires mockValue for structured output.',
      );
    }
    const parsed = input.schema.safeParse(input.mockValue);
    if (!parsed.success) {
      throw new AIError(
        'PROVIDER_INVALID_OUTPUT',
        'Mock structured output does not match the schema.',
        {
          details: {
            fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))],
          },
        },
      );
    }
    return {
      ...this.metadata,
      value: parsed.data,
      usage: usageFor(messageTokens(messages), JSON.stringify(parsed.data)),
    };
  }

  async *streamText(input: StreamTextInput): AsyncIterable<StreamEvent> {
    const messages = parseMessages(input.messages);
    const text = this.text ?? defaultStreamText;
    const characters = Array.from(text);
    for (let index = 0; index < characters.length; index += 6) {
      if (input.signal?.aborted) {
        yield {
          type: 'error',
          error: {
            code: 'PROVIDER_CANCELLED',
            message: 'The AI request was cancelled.',
            retryable: false,
          },
        };
        return;
      }
      yield { type: 'text_delta', text: characters.slice(index, index + 6).join('') };
    }
    yield {
      type: 'done',
      usage: usageFor(messageTokens(messages), text),
      finishReason: 'stop',
    };
  }

  async generateEmbedding(input: GenerateEmbeddingInput): Promise<GenerateEmbeddingResult> {
    throwIfAborted(input.signal);
    const values = parseEmbeddingValues(input.values);
    const dimensions = parseDimensions(input.dimensions);
    const embeddings = values.map((value) => deterministicVector(value, dimensions));
    const inputTokens = values.reduce((total, value) => total + Math.ceil(value.length / 4), 0);
    return {
      ...this.metadata,
      embeddings,
      usage: { inputTokens, outputTokens: 0, totalTokens: inputTokens },
    };
  }
}
