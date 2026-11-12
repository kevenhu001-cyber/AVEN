import {
  BlockUserRequestSchema,
  BlockUserResponseSchema,
  UnblockUserResponseSchema,
  ListBlocksResponseSchema,
  SubmitReportRequestSchema,
  SubmitReportResponseSchema,
  ListReportsResponseSchema,
} from '@aven/contracts';
import type {
  BlockUserRequest,
  BlockUserResponse,
  UnblockUserResponse,
  ListBlocksResponse,
  SubmitReportRequest,
  SubmitReportResponse,
  ListReportsResponse,
} from '@aven/contracts';
import type { TransportOptions } from './connections';

export type ModerationCallOptions = {
  csrfToken?: string;
  bearerToken?: string;
  signal?: AbortSignal;
};

export function createModerationClient(
  request: <T>(path: string, parse: (value: unknown) => T, init?: TransportOptions) => Promise<T>,
  invalidRequest: () => Error,
) {
  function authOptions(
    options: ModerationCallOptions,
    method: 'GET' | 'POST' | 'DELETE',
    body?: unknown,
  ): TransportOptions {
    const headers: Record<string, string> = {};
    if (options.bearerToken) {
      headers.Authorization = `Bearer ${options.bearerToken}`;
    }
    if (options.csrfToken) {
      headers['x-csrf-token'] = options.csrfToken;
    }
    return {
      method,
      headers,
      body,
      signal: options.signal,
    };
  }

  return {
    async blockUser(
      body: BlockUserRequest,
      options: ModerationCallOptions = {},
    ): Promise<BlockUserResponse> {
      const parsed = BlockUserRequestSchema.safeParse(body);
      if (!parsed.success) throw invalidRequest();
      return request(
        '/api/v1/blocks',
        (v) => BlockUserResponseSchema.parse(v),
        authOptions(options, 'POST', parsed.data),
      );
    },

    async unblockUser(
      userId: string,
      options: ModerationCallOptions = {},
    ): Promise<UnblockUserResponse> {
      if (!userId) throw invalidRequest();
      return request(
        `/api/v1/blocks/${encodeURIComponent(userId)}`,
        (v) => UnblockUserResponseSchema.parse(v),
        authOptions(options, 'DELETE'),
      );
    },

    async listBlocks(options: ModerationCallOptions = {}): Promise<ListBlocksResponse> {
      return request(
        '/api/v1/blocks',
        (v) => ListBlocksResponseSchema.parse(v),
        authOptions(options, 'GET'),
      );
    },

    async submitReport(
      body: SubmitReportRequest,
      options: ModerationCallOptions = {},
    ): Promise<SubmitReportResponse> {
      const parsed = SubmitReportRequestSchema.safeParse(body);
      if (!parsed.success) throw invalidRequest();
      return request(
        '/api/v1/reports',
        (v) => SubmitReportResponseSchema.parse(v),
        authOptions(options, 'POST', parsed.data),
      );
    },

    async listReports(options: ModerationCallOptions = {}): Promise<ListReportsResponse> {
      return request(
        '/api/v1/reports',
        (v) => ListReportsResponseSchema.parse(v),
        authOptions(options, 'GET'),
      );
    },
  };
}
