import {
  CalendarConnectAuthorizeRequestSchema,
  CalendarConnectAuthorizeResponseSchema,
  CalendarConnectCallbackRequestSchema,
  CalendarConnectionListResponseSchema,
  CalendarConnectionSummarySchema,
  CalendarOAuthProviderSchema,
  CalendarRevokeResponseSchema,
  CalendarSyncRequestSchema,
  CalendarSyncResultSchema,
  type CalendarConnectAuthorizeRequest,
  type CalendarConnectAuthorizeResponse,
  type CalendarConnectCallbackRequest,
  type CalendarConnectionListResponse,
  type CalendarConnectionSummary,
  type CalendarOAuthProvider,
  type CalendarRevokeResponse,
  type CalendarSyncRequest,
  type CalendarSyncResult,
} from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';

export type CalendarConnectionCallOptions = ConnectionCallOptions;

export type CalendarConnectionsClient = ReturnType<typeof createCalendarConnectionsClient>;

export function createCalendarConnectionsClient(request: ApiRequest, invalidRequest: () => Error) {
  return {
    async list(options: CalendarConnectionCallOptions): Promise<CalendarConnectionListResponse> {
      const transport = authenticatedOptions(options, 'GET', invalidRequest);
      return request(
        '/api/v1/availability/connections',
        (value) => CalendarConnectionListResponseSchema.parse(value),
        transport,
      );
    },

    async authorize(
      input: CalendarConnectAuthorizeRequest,
      options: CalendarConnectionCallOptions,
    ): Promise<CalendarConnectAuthorizeResponse> {
      const parsed = CalendarConnectAuthorizeRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      const transport = authenticatedOptions(options, 'POST', invalidRequest);
      return request(
        '/api/v1/availability/connections/authorize',
        (value) => CalendarConnectAuthorizeResponseSchema.parse(value),
        { ...transport, body: parsed.data },
      );
    },

    async callback(
      input: CalendarConnectCallbackRequest,
      options: CalendarConnectionCallOptions,
    ): Promise<CalendarConnectionSummary> {
      const parsed = CalendarConnectCallbackRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      const transport = authenticatedOptions(options, 'POST', invalidRequest);
      return request(
        '/api/v1/availability/connections/callback',
        (value) => CalendarConnectionSummarySchema.parse(value),
        { ...transport, body: parsed.data },
      );
    },

    async sync(
      input: CalendarSyncRequest,
      options: CalendarConnectionCallOptions,
    ): Promise<CalendarSyncResult> {
      const parsed = CalendarSyncRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      const transport = authenticatedOptions(options, 'POST', invalidRequest);
      return request(
        `/api/v1/availability/connections/${encodeURIComponent(parsed.data.provider)}/sync`,
        (value) => CalendarSyncResultSchema.parse(value),
        { ...transport, body: parsed.data },
      );
    },

    async revoke(
      provider: CalendarOAuthProvider,
      options: CalendarConnectionCallOptions,
    ): Promise<CalendarRevokeResponse> {
      const parsed = CalendarOAuthProviderSchema.safeParse(provider);
      if (!parsed.success) throw invalidRequest();
      const transport = authenticatedOptions(options, 'POST', invalidRequest);
      return request(
        `/api/v1/availability/connections/${encodeURIComponent(parsed.data)}/revoke`,
        (value) => CalendarRevokeResponseSchema.parse(value),
        { ...transport, body: {} },
      );
    },
  };
}
