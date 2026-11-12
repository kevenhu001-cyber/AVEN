import {
  ConnectionDecisionRequestSchema,
  ConnectionInvitationListSchema,
  ConnectionInvitationSchema,
  ConnectionPreviewSchema,
  ConnectionSnapshotSchema,
  ConnectionWidgetSchema,
  ConnectionWithdrawRequestSchema,
  CreateConnectionPreviewRequestSchema,
  DeletePeerMessageResponseSchema,
  ListPeerMessagesQuerySchema,
  ListPeerMessagesResponseSchema,
  PeerConnectionListSchema,
  PeerMessageSchema,
  RequestIdSchema,
  SendConnectionInvitationRequestSchema,
  SendPeerMessageRequestSchema,
} from '@aven/contracts';
import type {
  CreateConnectionPreviewRequest,
  DeletePeerMessageResponse,
  ListPeerMessagesResponse,
  PeerMessage,
  SendPeerMessageRequest,
} from '@aven/contracts';

export type ConnectionCallOptions = {
  auth: { kind: 'web'; csrfToken?: string } | { kind: 'mobile'; bearerToken: string };
  signal?: AbortSignal | undefined;
};
export type TransportOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal | undefined;
};
export type ApiRequest = <T>(
  path: string,
  parse: (value: unknown) => T,
  options?: TransportOptions,
) => Promise<T>;
type Schema<T> = { safeParse: (value: unknown) => { success: false } | { success: true; data: T } };

export function authenticatedOptions(
  call: ConnectionCallOptions,
  method: 'GET' | 'POST' | 'DELETE' | boolean,
  invalid: () => Error,
): TransportOptions {
  const httpMethod = typeof method === 'boolean' ? (method ? 'POST' : 'GET') : method;
  const write = httpMethod === 'POST' || httpMethod === 'DELETE';
  const headers: Record<string, string> = {};
  const token = call.auth.kind === 'mobile' ? call.auth.bearerToken : call.auth.csrfToken;
  if ((write || call.auth.kind === 'mobile') && (!token || /\s/.test(token))) throw invalid();
  if (call.auth.kind === 'mobile') headers.Authorization = `Bearer ${token}`;
  else if (write) headers['X-CSRF-Token'] = token!;
  return {
    headers,
    credentials: call.auth.kind === 'mobile' ? 'omit' : 'include',
    signal: call.signal,
    method: httpMethod,
  };
}

export function createConnectionsClient(request: ApiRequest, invalid: () => Error) {
  function validate<T>(schema: Schema<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw invalid();
    return result.data;
  }
  const options = (
    call: ConnectionCallOptions,
    method: 'GET' | 'POST' | 'DELETE' | boolean = false,
  ) => authenticatedOptions(call, method, invalid);
  const base = '/api/v1/connections';
  function path(id: string) {
    return `${base}/invitations/${validate(RequestIdSchema, id)}`;
  }
  return {
    async preview(
      input: Omit<CreateConnectionPreviewRequest, 'expiresInDays'> & { expiresInDays?: number },
      call: ConnectionCallOptions,
    ) {
      const body = validate(CreateConnectionPreviewRequestSchema, input);
      return request(`${base}/previews`, ConnectionPreviewSchema.parse, {
        ...options(call, true),
        body,
      });
    },
    async send(previewId: string, idempotencyKey: string, call: ConnectionCallOptions) {
      const body = validate(SendConnectionInvitationRequestSchema, { previewId });
      const key = validate(RequestIdSchema, idempotencyKey);
      const init = options(call, true);
      return request(`${base}/invitations`, ConnectionInvitationSchema.parse, {
        ...init,
        headers: { ...init.headers, 'Idempotency-Key': key },
        body,
      });
    },
    async listInvitations(call: ConnectionCallOptions) {
      return request(`${base}/invitations`, ConnectionInvitationListSchema.parse, options(call));
    },
    async getInvitation(id: string, call: ConnectionCallOptions) {
      return request(path(id), ConnectionInvitationSchema.parse, options(call));
    },
    async getSnapshot(id: string, call: ConnectionCallOptions) {
      return request(`${path(id)}/snapshot`, ConnectionSnapshotSchema.parse, options(call));
    },
    async getWidget(id: string, call: ConnectionCallOptions) {
      return request(`${path(id)}/widget`, ConnectionWidgetSchema.parse, options(call));
    },
    async decide(
      id: string,
      input: { decision: 'accepted' | 'declined'; expectedVersion: number },
      call: ConnectionCallOptions,
    ) {
      const body = validate(ConnectionDecisionRequestSchema, input);
      return request(`${path(id)}/decision`, ConnectionInvitationSchema.parse, {
        ...options(call, true),
        body,
      });
    },
    async withdraw(id: string, expectedVersion: number, call: ConnectionCallOptions) {
      const body = validate(ConnectionWithdrawRequestSchema, { expectedVersion });
      return request(`${path(id)}/withdraw`, ConnectionInvitationSchema.parse, {
        ...options(call, true),
        body,
      });
    },
    async revoke(id: string, call: ConnectionCallOptions) {
      return request(`${path(id)}/revoke`, ConnectionInvitationSchema.parse, options(call, true));
    },
    async listConnections(call: ConnectionCallOptions) {
      return request(base, PeerConnectionListSchema.parse, options(call));
    },
    async listMessages(
      connectionId: string,
      query: { limit?: number; cursorCreatedAt?: string; cursorId?: string } = {},
      call: ConnectionCallOptions,
    ): Promise<ListPeerMessagesResponse> {
      const connId = validate(RequestIdSchema, connectionId);
      const q = validate(ListPeerMessagesQuerySchema, query);
      const params = new URLSearchParams();
      if (q.limit !== undefined) params.set('limit', String(q.limit));
      if (q.cursorCreatedAt !== undefined) params.set('cursorCreatedAt', q.cursorCreatedAt);
      if (q.cursorId !== undefined) params.set('cursorId', q.cursorId);
      const qs = params.toString();
      const url = `${base}/${connId}/messages${qs ? `?${qs}` : ''}`;
      return request(url, ListPeerMessagesResponseSchema.parse, options(call, 'GET'));
    },
    async sendMessage(
      connectionId: string,
      input: SendPeerMessageRequest,
      call: ConnectionCallOptions,
    ): Promise<PeerMessage> {
      const connId = validate(RequestIdSchema, connectionId);
      const body = validate(SendPeerMessageRequestSchema, input);
      return request(`${base}/${connId}/messages`, PeerMessageSchema.parse, {
        ...options(call, 'POST'),
        body,
      });
    },
    async deleteMessage(
      connectionId: string,
      messageId: string,
      call: ConnectionCallOptions,
    ): Promise<DeletePeerMessageResponse> {
      const connId = validate(RequestIdSchema, connectionId);
      const msgId = validate(RequestIdSchema, messageId);
      return request(
        `${base}/${connId}/messages/${msgId}`,
        DeletePeerMessageResponseSchema.parse,
        options(call, 'DELETE'),
      );
    },
  };
}
