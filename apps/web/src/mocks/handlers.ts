/**
 * Request dispatcher for the local mock API layer. Every JSON response is validated
 * through the same @aven/contracts schema the real server uses, so shape drift fails
 * in unit tests instead of silently breaking the UI. There is no authorization model:
 * the layer exists purely for UI development without Docker/Postgres and is enabled
 * only when AVEN_WEB_MOCK=1.
 */
import {
  AIProviderStatusSchema,
  AgentCancelResponseSchema,
  AgentRunSchema,
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  AuthResponseSchema,
  ConnectionInvitationListSchema,
  ConversationListSchema,
  ConversationMessageListSchema,
  MeResponseSchema,
  MemoryDetailSchema,
  MemoryListResponseSchema,
  MemoryCandidateListResponseSchema,
  NotificationListSchema,
  NotificationPreferencesSchema,
  NotificationSchema,
  OkResponseSchema,
  PluginCatalogResponseSchema,
  PluginInvokeResponseSchema,
  RegisterResponseSchema,
  UpdateNotificationPreferencesSchema,
  UserAIProviderInputSchema,
  type UserAIProviderMetadata,
} from '@aven/contracts';
import { MOCK_CSRF_TOKEN, MOCK_USER } from './state';
import {
  appendMessage,
  connectConnector,
  createMemory,
  createRun,
  deleteMemory,
  deleteProvider,
  disconnectConnector,
  ensureConversation,
  ensureSeeded,
  finishRun,
  getConversation,
  getPreferences,
  getProvider,
  getRun,
  listCatalog,
  listConversationMessages,
  listConversations,
  listConnectors,
  listMemories,
  listNotifications,
  nextId,
  nowIso,
  readNotification,
  refreshConnector,
  requestCancel,
  saveProvider,
  updateMemory,
  updatePreferences,
  type MockRun,
} from './state';
import { chunkReply, mockReply } from './replies';

export const MOCK_HEADER = { 'x-aven-mock': '1' };
const CSRF_COOKIE = `aven_csrf=${MOCK_CSRF_TOKEN}; Path=/; SameSite=Lax`;

export type MockResult =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'empty'; status: number; headers?: Record<string, string> }
  | { kind: 'sse'; status: number; runId: string; headers?: Record<string, string> };

function mockSession() {
  const now = nowIso();
  return {
    id: '77777777-7777-4777-8777-777777777701',
    client: 'web' as const,
    userAgent: null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
    current: true,
  };
}

function mockMe() {
  return MeResponseSchema.parse({ user: { ...MOCK_USER }, session: mockSession() });
}

function providerMetadata(): UserAIProviderMetadata | null {
  return getProvider();
}

const idempotentTurns = new Map<string, unknown>();

/** Build the SSE event stream for one run; the reply lands in the conversation like the real worker does. */
function runEventStream(run: MockRun): ReadableStream<Uint8Array> {
  const reply = mockReply(run.input);
  const chunks = chunkReply(reply);
  const encoder = new TextEncoder();
  let sequence = 0;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const frame = (type: string, extra: Record<string, unknown> = {}) => {
        sequence += 1;
        const data = JSON.stringify({
          schema_version: 1,
          run_id: run.id,
          sequence,
          timestamp: nowIso(),
          ...extra,
        });
        controller.enqueue(encoder.encode(`id: ${sequence}\nevent: ${type}\ndata: ${data}\n\n`));
      };
      frame('turn.started');
      run.status = 'running';
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (run.cancelRequested) break;
        frame('message.delta', { text: chunk });
      }
      if (run.cancelRequested) {
        frame('turn.cancelled');
        finishRun(run, 'cancelled');
      } else {
        // Mirror the real Worker: one derived message per run lands in the conversation.
        appendMessage(getConversation(run.conversationId)!, reply, run.id);
        frame('turn.completed');
        finishRun(run, 'completed');
      }
      controller.close();
    },
  });
}

/** Dispatch one /api/v1 request; `segments` excludes the /api/v1 prefix. Undefined = no mock route. */
export function mockRequest(
  method: string,
  segments: string[],
  search: URLSearchParams,
  body: unknown,
  headers: Record<string, string>,
): MockResult | undefined {
  ensureSeeded();
  const [head, second, third] = segments;
  const json = (
    status: number,
    responseBody: unknown,
    extra?: Record<string, string>,
  ): MockResult => ({
    kind: 'json',
    status,
    body: responseBody,
    headers: { ...MOCK_HEADER, ...(extra ?? {}) },
  });
  const empty = (status: number, extra?: Record<string, string>): MockResult => ({
    kind: 'empty',
    status,
    headers: { ...MOCK_HEADER, ...(extra ?? {}) },
  });

  // ---------- auth ----------
  if (head === 'auth') {
    if (second === 'me' && method === 'GET')
      return json(200, mockMe(), { 'Set-Cookie': CSRF_COOKIE });
    if (second === 'login' && method === 'POST') {
      return json(
        200,
        AuthResponseSchema.parse({
          user: { ...MOCK_USER },
          session: mockSession(),
          csrfToken: MOCK_CSRF_TOKEN,
        }),
        { 'Set-Cookie': CSRF_COOKIE },
      );
    }
    if (second === 'register' && method === 'POST') {
      return json(
        201,
        RegisterResponseSchema.parse({ user: { ...MOCK_USER }, verificationRequired: true }),
      );
    }
    if (second === 'verify-email' && method === 'POST')
      return json(200, OkResponseSchema.parse({ ok: true }));
    if (second === 'logout' && method === 'POST')
      return empty(204, { 'Set-Cookie': 'aven_csrf=; Max-Age=0; Path=/' });
    return undefined;
  }

  // ---------- agent ----------
  if (head === 'agent') {
    if (second === 'provider' && third === undefined && method === 'GET') {
      const metadata = providerMetadata();
      return json(200, { data: metadata });
    }
    if (second === 'provider' && third === 'status' && method === 'GET') {
      const configured = providerMetadata() !== null;
      return json(
        200,
        AIProviderStatusSchema.parse({
          configured,
          source: configured ? 'user' : 'environment',
          model: configured ? providerMetadata()!.model : 'mock',
          baseUrl: configured ? providerMetadata()!.baseUrl : null,
        }),
      );
    }
    if (second === 'provider' && method === 'PUT') {
      const parsed = UserAIProviderInputSchema.safeParse(body);
      if (!parsed.success)
        return json(422, { error: { code: 'INVALID_REQUEST', request_id: nextId('8') } });
      return json(200, { data: saveProvider(parsed.data) });
    }
    if (second === 'provider' && method === 'DELETE') {
      const version = Number(search.get('version') ?? '0');
      const deleted = deleteProvider(Number.isFinite(version) ? version : 0);
      return json(200, { data: deleted ? null : providerMetadata() });
    }
    if (second === 'conversations' && third === undefined && method === 'GET') {
      const data = listConversations();
      const limit = Math.max(1, Math.min(50, Number(search.get('limit') ?? '20') || 20));
      return json(
        200,
        ConversationListSchema.parse({ data: data.slice(0, limit), nextCursor: null }),
      );
    }
    if (
      second === 'conversations' &&
      third !== undefined &&
      segments[3] === 'messages' &&
      method === 'GET'
    ) {
      const conversation = getConversation(third);
      if (!conversation)
        return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
      const messages = listConversationMessages(third);
      const limit = Math.max(1, Math.min(200, Number(search.get('limit') ?? '100') || 100));
      return json(
        200,
        ConversationMessageListSchema.parse({ data: messages.slice(0, limit), nextCursor: null }),
      );
    }
    if (second === 'turns' && method === 'POST') {
      const key = headers['idempotency-key'];
      if (key && idempotentTurns.has(key)) return json(201, idempotentTurns.get(key));
      const parsed = AgentTurnRequestSchema.safeParse(body);
      if (!parsed.success)
        return json(422, { error: { code: 'INVALID_REQUEST', request_id: nextId('8') } });
      const conversation = ensureConversation(parsed.data.conversationId);
      appendMessage(conversation, parsed.data.input, null);
      const run = createRun(conversation.id, parsed.data.input);
      const response = AgentTurnResponseSchema.parse({
        runId: run.id,
        conversationId: conversation.id,
        status: run.status,
        streamUrl: `/api/v1/agent/runs/${run.id}/events`,
      });
      if (key) idempotentTurns.set(key, response);
      return json(201, response);
    }
    if (second === 'runs' && third !== undefined) {
      const run = getRun(third);
      if (segments[3] === undefined && method === 'GET') {
        if (!run) return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
        return json(
          200,
          AgentRunSchema.parse({
            id: run.id,
            conversationId: run.conversationId,
            status: run.status,
            provider: run.provider,
            model: run.model,
            inputSummary: 'mock-user-turn',
            outputSummary: run.status === 'completed' ? 'assistant_response' : null,
            errorCode: null,
            cancelRequestedAt: run.cancelRequested ? run.createdAt : null,
            startedAt: run.status === 'queued' ? null : run.createdAt,
            completedAt: ['completed', 'cancelled', 'failed'].includes(run.status)
              ? run.createdAt
              : null,
            createdAt: run.createdAt,
            updatedAt: nowIso(),
          }),
        );
      }
      if (segments[3] === 'events' && method === 'GET') {
        if (!run) return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
        return { kind: 'sse', status: 200, runId: run.id, headers: MOCK_HEADER };
      }
      if (segments[3] === 'cancel' && method === 'POST') {
        if (!run) return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
        const cancelled = requestCancel(run.id)!;
        return json(
          200,
          AgentCancelResponseSchema.parse({ runId: cancelled.id, status: cancelled.status }),
        );
      }
    }
    return undefined;
  }

  // ---------- memories ----------
  if (head === 'memories') {
    const asDetail = (item: ReturnType<typeof listMemories>[number]) =>
      MemoryDetailSchema.parse({ ...item, sources: [] });
    if (second === undefined && method === 'GET') {
      const confirmed = listMemories().filter((item) => item.status === 'confirmed');
      return json(200, MemoryListResponseSchema.parse({ data: confirmed, nextCursor: null }));
    }
    if (second === 'usable' && method === 'GET') {
      return json(
        200,
        MemoryListResponseSchema.parse({
          data: listMemories().filter((item) => item.status === 'confirmed'),
          nextCursor: null,
        }),
      );
    }
    if (second === 'candidates' && method === 'GET') {
      const pending = listMemories().filter((item) => item.status === 'pending_confirmation');
      return json(
        200,
        MemoryCandidateListResponseSchema.parse({
          data: pending.map((item) => ({ ...item, source: null })),
          nextCursor: null,
        }),
      );
    }
    if (second === undefined && method === 'POST') {
      const created = createMemory((body ?? {}) as Record<string, never>);
      return json(201, asDetail(created));
    }
    if (
      second !== undefined &&
      third !== undefined &&
      method === 'POST' &&
      ['confirm', 'reject'].includes(third)
    ) {
      const memory = listMemories().find((item) => item.id === second);
      if (!memory) return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
      const next = third === 'confirm' ? 'confirmed' : 'rejected';
      const updated = updateMemory(
        second,
        Number((body as { expectedVersion?: number })?.expectedVersion ?? memory.version),
        {
          status: next,
          confirmedAt: next === 'confirmed' ? nowIso() : memory.confirmedAt,
          policy:
            next === 'confirmed'
              ? {
                  ...memory.policy,
                  allowedUses: (body as { allowedUses?: [] })?.allowedUses ?? [],
                  version: memory.policy.version + 1,
                }
              : memory.policy,
        },
      );
      if (!updated)
        return json(409, { error: { code: 'VERSION_CONFLICT', request_id: nextId('8') } });
      return json(200, asDetail(updated));
    }
    if (second !== undefined && third === undefined && method === 'PATCH') {
      const memory = listMemories().find((item) => item.id === second);
      if (!memory) return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
      const patch = (body ?? {}) as Record<string, unknown>;
      const updated = updateMemory(
        second,
        Number(patch.expectedVersion ?? memory.version),
        patch as Partial<typeof memory>,
      );
      if (!updated)
        return json(409, { error: { code: 'VERSION_CONFLICT', request_id: nextId('8') } });
      return json(200, asDetail(updated));
    }
    if (second !== undefined && third === undefined && method === 'DELETE') {
      const deleted = deleteMemory(second, Number(search.get('expectedVersion') ?? '0'));
      if (!deleted)
        return json(409, { error: { code: 'VERSION_CONFLICT', request_id: nextId('8') } });
      return empty(204);
    }
    return undefined;
  }

  // ---------- notifications ----------
  if (head === 'notifications') {
    if (second === 'preferences' && method === 'GET') {
      return json(200, NotificationPreferencesSchema.parse(getPreferences()));
    }
    if (second === 'preferences' && method === 'PUT') {
      const parsed = UpdateNotificationPreferencesSchema.safeParse(body);
      if (!parsed.success)
        return json(422, { error: { code: 'INVALID_REQUEST', request_id: nextId('8') } });
      const current = getPreferences();
      const next = updatePreferences({
        connectionInvitations: parsed.data.connectionInvitations ?? current.connectionInvitations,
        connectionUpdates: parsed.data.connectionUpdates ?? current.connectionUpdates,
        eventInvitations: parsed.data.eventInvitations ?? current.eventInvitations,
        eventUpdates: parsed.data.eventUpdates ?? current.eventUpdates,
        version: current.version,
      });
      return json(200, NotificationPreferencesSchema.parse(next));
    }
    if (second !== undefined && third === 'read' && method === 'POST') {
      const notification = readNotification(second);
      if (!notification)
        return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
      return json(
        200,
        NotificationSchema.parse({
          id: notification.id,
          kind: notification.kind,
          target: notification.target,
          createdAt: notification.createdAt,
          readAt: notification.readAt,
        }),
      );
    }
    if (second === undefined && method === 'GET') {
      return json(200, NotificationListSchema.parse(listNotifications()));
    }
    return undefined;
  }

  // ---------- plugins ----------
  if (head === 'plugins') {
    if (second === undefined && method === 'GET') {
      const plugins = listCatalog();
      return json(200, PluginCatalogResponseSchema.parse({ plugins, total: plugins.length }));
    }
    if (second !== undefined && third === 'invoke' && method === 'POST') {
      const plugin = listCatalog().find((item) => item.id === second);
      if (!plugin) return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
      const action = String(
        (body as { action?: string })?.action ?? plugin.actions[0]?.name ?? 'run',
      );
      return json(
        200,
        PluginInvokeResponseSchema.parse({
          invocationId: nextId('9'),
          pluginId: plugin.id,
          action,
          providerMode: plugin.credentialStatus === 'configured' ? 'live' : 'mock',
          summary: '【模拟结果】本地模拟模式返回的固定结果，不来自真实服务。',
          data: {},
          widgets: [],
          auditRef: 'mock-audit-ref',
          executedAt: nowIso(),
        }),
      );
    }
    return undefined;
  }

  // ---------- open-connector ----------
  if (head === 'open-connector') {
    if (second === undefined && method === 'GET') return json(200, listConnectors());
    if (second !== undefined && third === 'connect' && method === 'POST') {
      connectConnector(second);
      return json(200, {
        authorizationUrl: `https://example.test/authorize?service=${second}`,
        expiresAt: nowIso(),
      });
    }
    if (second !== undefined && third === 'refresh' && method === 'POST') {
      if (!refreshConnector(second))
        return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
      return json(200, { ok: true });
    }
    if (second !== undefined && third === undefined && method === 'DELETE') {
      if (!disconnectConnector(second))
        return json(404, { error: { code: 'NOT_FOUND', request_id: nextId('8') } });
      return json(200, { ok: true });
    }
    return undefined;
  }

  // ---------- peer connections ----------
  if (head === 'connections') {
    if (second === 'invitations' && method === 'GET') {
      return json(200, ConnectionInvitationListSchema.parse({ data: [] }));
    }
    if (second === undefined && method === 'GET') {
      return json(200, { data: [] });
    }
    return undefined;
  }

  return undefined;
}

/** Build the event stream for a run created earlier by POST /agent/turns. */
export function createMockEventStream(runId: string): ReadableStream<Uint8Array> | undefined {
  const run = getRun(runId);
  if (!run) return undefined;
  return runEventStream(run);
}
