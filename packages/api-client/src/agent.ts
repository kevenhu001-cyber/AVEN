import {
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  AgentRunSchema,
  AgentCancelResponseSchema,
  AgentStreamEventSchema,
  AIProviderStatusSchema,
  UserAIProviderInputSchema,
  UserAIProviderMetadataSchema,
  ApiErrorResponseSchema,
  RequestIdSchema,
} from '@aven/contracts';
import type { AgentTurnRequest, AgentStreamEvent, UserAIProviderInput } from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';
import { ApiClientError } from './errors';
import { readSse } from './sse';

export function createAgentClient(
  request: ApiRequest,
  transport: { baseUrl: string; fetcher: typeof fetch; timeoutMs: number },
) {
  const { fetcher } = transport;
  const invalid = () => new ApiClientError('INVALID_REQUEST');
  function id(value: string) {
    const parsed = RequestIdSchema.safeParse(value);
    if (!parsed.success) throw invalid();
    return parsed.data;
  }
  function key(value: string) {
    if (!value.trim() || value.length > 200 || /[\r\n]/.test(value)) throw invalid();
    return value;
  }
  const path = (runId: string) => `/api/v1/agent/runs/${id(runId)}`;
  return {
    providerStatus(call: ConnectionCallOptions) {
      return request(
        '/api/v1/agent/provider/status',
        AIProviderStatusSchema.parse,
        authenticatedOptions(call, false, invalid),
      );
    },
    getProvider(call: ConnectionCallOptions) {
      return request(
        '/api/v1/agent/provider',
        (value) => {
          if (!value || typeof value !== 'object' || !('data' in value)) throw invalid();
          const data = (value as { data: unknown }).data;
          return data === null ? null : UserAIProviderMetadataSchema.parse(data);
        },
        authenticatedOptions(call, false, invalid),
      );
    },
    saveProvider(input: UserAIProviderInput, call: ConnectionCallOptions) {
      const parsed = UserAIProviderInputSchema.safeParse(input);
      if (!parsed.success) throw invalid();
      return request(
        '/api/v1/agent/provider',
        (value) => {
          if (!value || typeof value !== 'object' || !('data' in value)) throw invalid();
          return UserAIProviderMetadataSchema.parse((value as { data: unknown }).data);
        },
        { ...authenticatedOptions(call, 'PUT', invalid), body: parsed.data },
      );
    },
    deleteProvider(version: number, call: ConnectionCallOptions) {
      if (!Number.isSafeInteger(version) || version <= 0) throw invalid();
      return request(
        `/api/v1/agent/provider?version=${version}`,
        (value) => {
          if (!value || typeof value !== 'object' || !('deleted' in value)) throw invalid();
          return Boolean((value as { deleted: unknown }).deleted);
        },
        authenticatedOptions(call, 'DELETE', invalid),
      );
    },
    createTurn(input: AgentTurnRequest, idempotencyKey: string, call: ConnectionCallOptions) {
      const parsed = AgentTurnRequestSchema.safeParse(input);
      if (!parsed.success) throw invalid();
      const options = authenticatedOptions(call, true, invalid);
      return request(
        '/api/v1/agent/turns',
        (value) => {
          const turn = AgentTurnResponseSchema.parse(value);
          if (turn.streamUrl !== `${path(turn.runId)}/events`)
            throw new Error('Unexpected stream URL.');
          return turn;
        },
        {
          ...options,
          headers: { ...options.headers, 'Idempotency-Key': key(idempotencyKey) },
          body: parsed.data,
        },
      );
    },
    getRun(runId: string, call: ConnectionCallOptions) {
      return request(path(runId), AgentRunSchema.parse, authenticatedOptions(call, false, invalid));
    },
    cancel(runId: string, idempotencyKey: string, call: ConnectionCallOptions) {
      const options = authenticatedOptions(call, true, invalid);
      return request(`${path(runId)}/cancel`, AgentCancelResponseSchema.parse, {
        ...options,
        headers: { ...options.headers, 'Idempotency-Key': key(idempotencyKey) },
      });
    },
    async *events(
      runId: string,
      cursor: number,
      call: ConnectionCallOptions,
    ): AsyncGenerator<AgentStreamEvent> {
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw invalid();
      const options = authenticatedOptions(call, false, invalid);
      if (call.signal?.aborted) throw new ApiClientError('CANCELLED');
      const controller = new AbortController();
      const abort = () => controller.abort();
      call.signal?.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, transport.timeoutMs);
      let terminal = false;
      let sequence = cursor;
      try {
        const response = await fetcher(`${transport.baseUrl}${path(runId)}/events`, {
          credentials: options.credentials ?? 'include',
          method: 'GET',
          headers: {
            ...options.headers,
            Accept: 'text/event-stream',
            'Last-Event-ID': String(cursor),
          },
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          const error = ApiErrorResponseSchema.safeParse(await response.json());
          throw new ApiClientError(
            'HTTP_ERROR',
            response.status,
            error.success ? error.data.error.request_id : undefined,
            error.success ? error.data.error.code : undefined,
          );
        }
        if (
          !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') ||
          !response.body
        )
          throw new ApiClientError('INVALID_RESPONSE');
        for await (const event of readSse(response.body, controller.signal)) {
          const data: unknown = JSON.parse(event.data);
          if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new ApiClientError('INVALID_RESPONSE');
          const parsed = AgentStreamEventSchema.safeParse({ ...data, type: event.event });
          if (!parsed.success || parsed.data.run_id !== runId)
            throw new ApiClientError('INVALID_RESPONSE');
          const frame = parsed.data;
          if (
            event.id !== undefined &&
            (!/^\d+$/.test(event.id) || Number(event.id) !== frame.sequence)
          )
            throw new ApiClientError('INVALID_RESPONSE');
          if (frame.sequence <= sequence) continue;
          if (frame.sequence !== sequence + 1) throw new ApiClientError('INVALID_RESPONSE');
          sequence = frame.sequence;
          terminal = ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(frame.type);
          yield frame;
          if (terminal) return;
        }
        if (!terminal) throw new ApiClientError('NETWORK_ERROR');
      } catch (error) {
        if (call.signal?.aborted) throw new ApiClientError('CANCELLED');
        if (timedOut) throw new ApiClientError('TIMEOUT');
        if (error instanceof ApiClientError) throw error;
        if (error instanceof SyntaxError) throw new ApiClientError('INVALID_RESPONSE');
        throw new ApiClientError('NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
        call.signal?.removeEventListener('abort', abort);
        controller.abort();
      }
    },
  };
}
