import { ApiClientError } from './errors';
import { createPersonalClient } from './personal';
import { createActionsClient } from './actions';
import { createAgentClient } from './agent';
import {
  ApiErrorResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
} from '@aven/contracts';
import type { LivenessResponse, ReadinessResponse } from '@aven/contracts';
import { createConnectionsClient } from './connections';
import type { TransportOptions } from './connections';
import { createCalendarConnectionsClient } from './calendar-connections';
import { createEventsClient } from './events';
import { createNotificationsClient } from './notifications';
import { createModerationClient } from './moderation';
import { createPluginsClient } from './plugins';
import { createReferralsClient } from './referrals';
export type {
  CalendarConnectionsClient,
  CalendarConnectionCallOptions,
} from './calendar-connections';
export type { NotificationCallOptions } from './notifications';
export type { ConnectionCallOptions } from './connections';
export type { EventsClient, EventCallOptions } from './events';
export type { ModerationCallOptions } from './moderation';
export type { PluginsClient, PluginCallOptions } from './plugins';
export type { ReferralsClient, ReferralCallOptions } from './referrals';

export { ApiClientError } from './errors';

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

  async function request<T>(
    path: string,
    parse: (value: unknown) => T,
    init: TransportOptions = {},
  ): Promise<T> {
    const signal = init.signal;
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
      const response = await fetcher(`${baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        credentials: init.credentials ?? 'include',
        cache: 'no-store',
        signal: controller.signal,
        redirect: 'error',
      });
      const body: unknown = response.status === 204 ? undefined : await response.json();
      if (signal?.aborted) throw new ApiClientError('CANCELLED');
      if (timedOut) throw new ApiClientError('TIMEOUT');
      if (!response.ok) {
        const error = ApiErrorResponseSchema.safeParse(body);
        throw new ApiClientError(
          'HTTP_ERROR',
          response.status,
          error.success ? error.data.error.request_id : undefined,
          error.success ? error.data.error.code : undefined,
        );
      }
      try {
        return parse(body);
      } catch {
        throw new ApiClientError('INVALID_RESPONSE');
      }
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
  }

  const personal = createPersonalClient(request, () => new ApiClientError('INVALID_REQUEST'));
  return {
    auth: personal.auth,
    actions: createActionsClient(request, () => new ApiClientError('INVALID_REQUEST')),
    memories: personal.memories,
    agent: createAgentClient(request, { baseUrl, fetcher, timeoutMs }),
    calendarConnections: createCalendarConnectionsClient(
      request,
      () => new ApiClientError('INVALID_REQUEST'),
    ),
    connections: createConnectionsClient(request, () => new ApiClientError('INVALID_REQUEST')),
    events: createEventsClient(request, () => new ApiClientError('INVALID_REQUEST')),
    notifications: createNotificationsClient(request, () => new ApiClientError('INVALID_REQUEST')),
    moderation: createModerationClient(request, () => new ApiClientError('INVALID_REQUEST')),
    plugins: createPluginsClient(request, () => new ApiClientError('INVALID_REQUEST')),
    referrals: createReferralsClient(request, () => new ApiClientError('INVALID_REQUEST')),
    async getLiveness(signal?: AbortSignal): Promise<LivenessResponse> {
      return request(
        '/health/live',
        (value) => {
          const result = LivenessResponseSchema.safeParse(value);
          if (!result.success || result.data.service !== 'api') {
            throw new ApiClientError('INVALID_RESPONSE');
          }
          return result.data;
        },
        { signal },
      );
    },
    async getReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
      return request(
        '/health/ready',
        (value) => {
          const result = ReadinessResponseSchema.safeParse(value);
          if (!result.success || result.data.service !== 'api') {
            throw new ApiClientError('INVALID_RESPONSE');
          }
          return result.data;
        },
        { signal },
      );
    },
  };
}

export { readSse } from './sse';
export type { SseEvent } from './sse';
export { initialPluginValues, missingRequiredFields, buildPluginInput } from './plugin-input';
export type { JsonSchemaProperty, PluginInputSchema } from './plugin-input';
