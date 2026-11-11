import { AIError } from './errors.js';
import {
  approximateTokens,
  messageTokens,
  parseDimensions,
  parseEmbeddingValues,
  parseGenerationOptions,
  parseMessages,
  type AIProvider,
  type AIProviderMetadata,
  type AIUsage,
  type GenerateEmbeddingInput,
  type GenerateEmbeddingResult,
  type GenerateObjectInput,
  type GenerateObjectResult,
  type GenerateTextInput,
  type GenerateTextResult,
  type StreamEvent,
  type StreamTextInput,
} from './provider.js';
import { isAbortError, withTimeout } from './timeout.js';

type JsonRecord = Record<string, unknown>;

export type OpenAICompatibleProviderOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readChoiceMessage(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return undefined;
  return readString(first.message.content);
}

function readFinishReason(payload: unknown): GenerateTextResult['finishReason'] {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return 'unknown';
  const first = payload.choices[0];
  const reason = isRecord(first) ? readString(first.finish_reason) : undefined;
  return reason === 'stop' || reason === 'length' || reason === 'content_filter'
    ? reason
    : 'unknown';
}

function readUsage(
  payload: unknown,
  messages: readonly { content: string }[],
  text: string,
): AIUsage {
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  const fallbackInputTokens = messages.reduce(
    (total, message) => total + approximateTokens(message.content),
    0,
  );
  const inputTokens = (usage ? readNumber(usage.prompt_tokens) : undefined) ?? fallbackInputTokens;
  const outputTokens =
    (usage ? readNumber(usage.completion_tokens) : undefined) ?? approximateTokens(text);
  const totalTokens =
    (usage ? readNumber(usage.total_tokens) : undefined) ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly metadata: AIProviderMetadata;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.metadata = { provider: 'openai_compatible', model: options.model, mock: false };
  }

  private mapHttpError(status: number): AIError {
    if (status === 429) {
      return new AIError('PROVIDER_RATE_LIMITED', 'The AI provider rate limit was reached.');
    }
    if (status === 401 || status === 403) {
      return new AIError('PROVIDER_AUTH_FAILED', 'The AI provider rejected the credentials.');
    }
    if (status === 400 || status === 422) {
      return new AIError('PROVIDER_INVALID_REQUEST', 'The AI provider rejected the request.');
    }
    if (status >= 500) {
      return new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is unavailable.');
    }
    return new AIError('PROVIDER_UNAVAILABLE', 'The AI provider returned an unexpected status.');
  }

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        {
          timeoutMs: this.timeoutMs,
          ...(signal ? { signal } : {}),
          timeoutCode: 'PROVIDER_TIMEOUT',
          cancelCode: 'PROVIDER_CANCELLED',
          timeoutMessage: 'The AI provider timed out.',
          cancelMessage: 'The AI request was cancelled.',
        },
      );
      if (!response.ok) throw this.mapHttpError(response.status);
      return response;
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (timedOut) {
        throw new AIError('PROVIDER_TIMEOUT', 'The AI provider timed out.');
      }
      if (signal?.aborted) {
        throw new AIError('PROVIDER_CANCELLED', 'The AI request was cancelled.');
      }
      if (isAbortError(error)) {
        throw new AIError('PROVIDER_CANCELLED', 'The AI request was cancelled.');
      }
      throw new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is unavailable.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    try {
      const value: unknown = await response.json();
      return value;
    } catch {
      throw new AIError('PROVIDER_INVALID_OUTPUT', 'The AI provider returned invalid JSON.');
    }
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const messages = parseMessages(input.messages);
    const { temperature, maxTokens } = parseGenerationOptions(input);
    const response = await this.request(
      '/chat/completions',
      {
        model: input.model ?? this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      },
      input.signal,
    );
    const payload = await this.parseJson(response);
    const text = readChoiceMessage(payload);
    if (text === undefined) {
      throw new AIError('PROVIDER_INVALID_OUTPUT', 'The AI provider returned no text.');
    }
    return {
      ...this.metadata,
      model: input.model ?? this.model,
      text,
      usage: readUsage(payload, messages, text),
      finishReason: readFinishReason(payload),
    };
  }

  async generateObject<T>(input: GenerateObjectInput<T>): Promise<GenerateObjectResult<T>> {
    const messages = parseMessages(input.messages);
    const { temperature, maxTokens } = parseGenerationOptions(input);
    const response = await this.request(
      '/chat/completions',
      {
        model: input.model ?? this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        stream: false,
      },
      input.signal,
    );
    const payload = await this.parseJson(response);
    const text = readChoiceMessage(payload);
    if (text === undefined) {
      throw new AIError(
        'PROVIDER_INVALID_OUTPUT',
        'The AI provider returned no structured output.',
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new AIError(
        'PROVIDER_INVALID_OUTPUT',
        'The AI provider returned invalid structured output.',
      );
    }
    const parsed = input.schema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AIError(
        'PROVIDER_INVALID_OUTPUT',
        'The AI provider output does not match the schema.',
        {
          details: {
            fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))],
          },
        },
      );
    }
    return {
      ...this.metadata,
      model: input.model ?? this.model,
      value: parsed.data,
      usage: readUsage(payload, messages, text),
    };
  }

  async generateEmbedding(input: GenerateEmbeddingInput): Promise<GenerateEmbeddingResult> {
    const values = parseEmbeddingValues(input.values);
    const dimensions =
      input.dimensions === undefined ? undefined : parseDimensions(input.dimensions);
    const response = await this.request(
      '/embeddings',
      {
        model: input.model ?? this.model,
        input: values,
        ...(dimensions === undefined ? {} : { dimensions }),
      },
      input.signal,
    );
    const payload = await this.parseJson(response);
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    if (data.length !== values.length) {
      throw new AIError(
        'PROVIDER_INVALID_OUTPUT',
        'The AI provider returned an unexpected embedding count.',
      );
    }
    const embeddings = data.map((item) => {
      const embedding =
        isRecord(item) && Array.isArray(item.embedding) ? item.embedding : undefined;
      if (
        !embedding ||
        !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
      ) {
        throw new AIError(
          'PROVIDER_INVALID_OUTPUT',
          'The AI provider returned an invalid embedding.',
        );
      }
      return embedding as number[];
    });
    const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
    const inputTokens = (usage ? readNumber(usage.prompt_tokens) : undefined) ?? 0;
    const totalTokens = (usage ? readNumber(usage.total_tokens) : undefined) ?? inputTokens;
    return {
      ...this.metadata,
      model: input.model ?? this.model,
      embeddings,
      usage: { inputTokens, outputTokens: 0, totalTokens },
    };
  }

  async *streamText(input: StreamTextInput): AsyncIterable<StreamEvent> {
    const messages = parseMessages(input.messages);
    const { temperature, maxTokens } = parseGenerationOptions(input);
    let response: Response;
    try {
      response = await this.request(
        '/chat/completions',
        {
          model: input.model ?? this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        },
        input.signal,
      );
    } catch (error) {
      const aiError =
        error instanceof AIError
          ? error
          : new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is unavailable.');
      yield {
        type: 'error',
        error: { code: aiError.code, message: aiError.message, retryable: aiError.retryable },
      };
      return;
    }
    if (!response.body) {
      yield {
        type: 'error',
        error: {
          code: 'PROVIDER_INVALID_OUTPUT',
          message: 'The AI provider returned no stream.',
          retryable: false,
        },
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    let usage: AIUsage = {
      inputTokens: messageTokens(messages),
      outputTokens: 0,
      totalTokens: messageTokens(messages),
    };
    let finishReason: GenerateTextResult['finishReason'] = 'unknown';
    try {
      for (;;) {
        const { done, value } = await withTimeout(reader.read(), {
          timeoutMs: this.timeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
          timeoutCode: 'PROVIDER_TIMEOUT',
          cancelCode: 'PROVIDER_CANCELLED',
          timeoutMessage: 'The AI provider stream timed out.',
          cancelMessage: 'The AI request was cancelled.',
        });
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (!isRecord(event) || !Array.isArray(event.choices)) continue;
          const first = event.choices[0];
          const reason = isRecord(first) ? readString(first.finish_reason) : undefined;
          if (reason === 'stop' || reason === 'length' || reason === 'content_filter') {
            finishReason = reason;
          }
          const delta = isRecord(first) && isRecord(first.delta) ? first.delta : undefined;
          const text = delta ? readString(delta.content) : undefined;
          if (text) {
            output += text;
            yield { type: 'text_delta', text };
          }
          if (isRecord(event.usage)) {
            const inputTokens = readNumber(event.usage.prompt_tokens) ?? usage.inputTokens;
            const outputTokens = readNumber(event.usage.completion_tokens) ?? usage.outputTokens;
            const totalTokens = readNumber(event.usage.total_tokens) ?? inputTokens + outputTokens;
            usage = { inputTokens, outputTokens, totalTokens };
          }
        }
      }
      const outputTokens = usage.outputTokens || approximateTokens(output);
      yield {
        type: 'done',
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens,
          totalTokens: usage.totalTokens || usage.inputTokens + outputTokens,
        },
        finishReason,
      };
    } catch (error) {
      const aiError =
        error instanceof AIError
          ? error
          : new AIError('PROVIDER_UNAVAILABLE', 'The AI provider stream failed.');
      yield {
        type: 'error',
        error: {
          code: aiError.code,
          message: aiError.message,
          retryable: aiError.retryable,
        },
      };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
