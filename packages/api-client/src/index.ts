import { ApiErrorResponseSchema, LivenessResponseSchema } from '@aven/contracts';
import type { LivenessResponse } from '@aven/contracts';

export class ApiClientError extends Error {
  constructor(
    public readonly code:
      'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'INVALID_RESPONSE' | 'HTTP_ERROR',
    public readonly status?: number,
    public readonly requestId?: string,
  ) {
    super(code);
    this.name = 'ApiClientError';
  }
}

export function createApiClient(
  options: {
    baseUrl?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Expected an HTTP(S) API origin.');
    }
  }
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout.');

  return {
    async getLiveness(signal?: AbortSignal): Promise<LivenessResponse> {
      if (signal?.aborted) throw new ApiClientError('CANCELLED');
      const controller = new AbortController();
      const abort = () => controller.abort();
      let timedOut = false;
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetcher(`${baseUrl}/health/live`, {
          headers: { Accept: 'application/json' },
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          redirect: 'error',
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const error = ApiErrorResponseSchema.safeParse(body);
          throw new ApiClientError(
            'HTTP_ERROR',
            response.status,
            error.success ? error.data.error.request_id : undefined,
          );
        }
        const result = LivenessResponseSchema.safeParse(body);
        if (!result.success || result.data.service !== 'api')
          throw new ApiClientError('INVALID_RESPONSE');
        return result.data;
      } catch (error) {
        if (signal?.aborted) throw new ApiClientError('CANCELLED');
        if (timedOut) throw new ApiClientError('TIMEOUT');
        if (error instanceof ApiClientError) throw error;
        if (error instanceof SyntaxError) throw new ApiClientError('INVALID_RESPONSE');
        throw new ApiClientError('NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

export { readSse } from './sse';
export type { SseEvent } from './sse';
