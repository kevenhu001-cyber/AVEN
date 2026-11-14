import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  AgentCancelResponseSchema,
  AgentRunEventSchema,
  AgentRunSchema,
  AgentTurnResponseSchema,
  ConversationListSchema,
  ConversationMessageListSchema,
  type AgentCancelResponse,
  type AgentRun,
  type AgentRunEvent,
  type AgentRunEventType,
  type AgentRunStatus,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type ConversationList,
  type ConversationMessageList,
} from '@aven/contracts';
import { parseAIProviderConfig } from '@aven/ai-core';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiCodeException } from '../http-errors.js';

type AgentRunRow = {
  id: string;
  conversation_id: string;
  status: AgentRunStatus;
  provider: string;
  model: string;
  input_summary: string;
  output_summary: string | null;
  error_code: string | null;
  cancel_requested_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AgentEventRow = {
  sequence: string | number;
  schema_version: number;
  event_type: AgentRunEventType;
  payload: Record<string, unknown>;
  created_at: Date;
};

type StreamContextRow = {
  run_id: string;
  status: AgentRunStatus;
  created_at: Date;
  latest_sequence: string | number;
  history_expired: boolean;
  sources_valid: boolean;
  terminal_event_type: AgentRunEventType | null;
};

export type AgentStreamContext = {
  runId: string;
  status: AgentRunStatus;
  createdAt: string;
  latestSequence: number;
  historyExpired: boolean;
  sourcesValid: boolean;
  terminalEventType: AgentRunEventType | null;
};

export type AgentStreamChunk = {
  data: string;
  sequence?: number;
};

function mapRun(row: AgentRunRow): AgentRun {
  return AgentRunSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    errorCode: row.error_code,
    cancelRequestedAt: row.cancel_requested_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

function mapEvent(row: AgentEventRow, runId: string): AgentRunEvent {
  return AgentRunEventSchema.parse({
    schemaVersion: row.schema_version,
    runId,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function formatAgentEvent(event: AgentRunEvent): string {
  const data = {
    ...event.payload,
    schema_version: 1,
    run_id: event.runId,
    sequence: event.sequence,
    timestamp: event.createdAt,
  };
  return `id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatAgentSafeFailure(runId: string, afterSequence: number, code: string): string {
  const data = {
    schema_version: 1,
    run_id: runId,
    sequence: afterSequence + 1,
    timestamp: new Date().toISOString(),
    error_code: code,
  };
  return `event: turn.failed\ndata: ${JSON.stringify(data)}\n\n`;
}

export function parseLastEventId(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  if (!/^\d+$/.test(value.trim())) {
    throw new ApiCodeException('INVALID_EVENT_CURSOR', 409, 'The event cursor is invalid.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiCodeException('INVALID_EVENT_CURSOR', 409, 'The event cursor is invalid.');
  }
  return parsed;
}

@Injectable()
export class AgentService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;
  private readonly provider: string;
  private readonly model: string;

  constructor() {
    const config = parseAIProviderConfig(process.env);
    this.provider = config.provider;
    this.model = config.model;
  }

  private getPool(): DatabasePool {
    this.pool ??= createApplicationPool({ max: 5 });
    return this.pool;
  }

  private context(auth: AuthContext) {
    return { principalId: auth.principalId, userId: auth.userId };
  }

  /**
   * Effective provider for this user: their own encrypted configuration first,
   * then the platform configuration, then the environment default. The run row
   * records the result so the Worker can load the matching key material.
   */
  private async resolveProvider(auth: AuthContext): Promise<{ provider: string; model: string }> {
    const effective = await withRequestContext(
      this.getPool(),
      this.context(auth),
      async (client) => {
        const result = await client.query<{ source: string; base_url: string; model: string }>(
          'SELECT * FROM app.get_effective_ai_provider()',
        );
        return result.rows[0];
      },
    );
    if (effective) return { provider: 'openai_compatible', model: effective.model };
    return { provider: this.provider, model: this.model };
  }

  async getProviderStatus(auth: AuthContext): Promise<{
    configured: boolean;
    source: 'user' | 'platform' | 'environment';
    model: string;
    baseUrl: string | null;
  }> {
    const effective = await withRequestContext(
      this.getPool(),
      this.context(auth),
      async (client) => {
        const result = await client.query<{ source: string; base_url: string; model: string }>(
          'SELECT * FROM app.get_effective_ai_provider()',
        );
        return result.rows[0];
      },
    );
    if (effective)
      return {
        configured: true,
        source: effective.source === 'user' ? 'user' : 'platform',
        model: effective.model,
        baseUrl: effective.base_url,
      };
    return {
      configured: this.provider !== 'mock',
      source: 'environment',
      model: this.model,
      baseUrl: null,
    };
  }

  async createTurn(
    auth: AuthContext,
    input: AgentTurnRequest,
    idempotencyKey: string,
  ): Promise<AgentTurnResponse> {
    const resolved = await this.resolveProvider(auth);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          conversationId: input.conversationId ?? null,
          organizationId: input.organizationId ?? null,
          input: input.input,
        }),
      )
      .digest('hex');
    const row = await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      let turn:
        | {
            run_id: string;
            conversation_id: string;
            status: AgentRunStatus;
            created: boolean;
          }
        | undefined;

      if (input.organizationId) {
        const result = await client.query<{
          run_id: string;
          conversation_id: string;
          status: AgentRunStatus;
          created: boolean;
        }>(`SELECT * FROM app.create_organization_agent_turn($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
          input.organizationId,
          input.conversationId ?? null,
          input.input,
          idempotencyKey,
          'POST',
          '/api/v1/agent/turns',
          requestHash,
          resolved.provider,
          resolved.model,
        ]);
        turn = result.rows[0];
      } else {
        const result = await client.query<{
          run_id: string;
          conversation_id: string;
          status: AgentRunStatus;
          created: boolean;
        }>(`SELECT * FROM app.create_agent_turn($1, $2, $3, $4, $5, $6, $7, $8)`, [
          idempotencyKey,
          'POST',
          '/api/v1/agent/turns',
          requestHash,
          input.conversationId ?? null,
          input.input,
          resolved.provider,
          resolved.model,
        ]);
        turn = result.rows[0];
      }

      if (!turn) throw new Error('AGENT_TURN_CREATE_FAILED');
      if (turn.created) {
        await client.query(
          `INSERT INTO public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ('agent_run', $1::uuid, 'agent.run.requested', jsonb_build_object('runId', $1::uuid))`,
          [turn.run_id],
        );
      }
      return turn;
    });
    return AgentTurnResponseSchema.parse({
      runId: row.run_id,
      conversationId: row.conversation_id,
      status: row.status,
      streamUrl: `/api/v1/agent/runs/${row.run_id}/events`,
    });
  }

  async getRun(auth: AuthContext, runId: string): Promise<AgentRun> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<AgentRunRow>('SELECT * FROM app.get_agent_run($1)', [runId]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return mapRun(row);
  }

  /**
   * Personal conversation history. Both reads are owner-scoped SQL functions over the
   * durable messages table (events expire after 24 hours), so restoring a conversation
   * never depends on the live event stream.
   */
  async listConversations(
    auth: AuthContext,
    limit: number,
    cursorCreatedAt: string | undefined,
    cursorId: string | undefined,
  ): Promise<ConversationList> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<{ result: unknown }>('SELECT app.list_conversations($1,$2,$3) AS result', [
        limit,
        cursorCreatedAt ?? null,
        cursorId ?? null,
      ]),
    );
    const list = result.rows[0]?.result;
    if (!list) throw new NotFoundException();
    return ConversationListSchema.parse(list);
  }

  async listConversationMessages(
    auth: AuthContext,
    conversationId: string,
    limit: number,
    cursorCreatedAt: string | undefined,
    cursorId: string | undefined,
  ): Promise<ConversationMessageList> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        return await client.query<{ result: unknown }>(
          'SELECT app.list_conversation_messages($1,$2,$3,$4) AS result',
          [conversationId, limit, cursorCreatedAt ?? null, cursorId ?? null],
        );
      } catch (error) {
        // The SQL function raises 42501 when the conversation is not owned by the
        // caller; that must surface as a plain 404 without leaking ownership facts.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === '42501'
        ) {
          throw new NotFoundException();
        }
        throw error;
      }
    });
    const list = result.rows[0]?.result;
    if (!list) throw new NotFoundException();
    return ConversationMessageListSchema.parse(list);
  }

  async getStreamContext(auth: AuthContext, runId: string): Promise<AgentStreamContext> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<StreamContextRow>('SELECT * FROM app.get_agent_run_stream_context($1)', [runId]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return {
      runId: row.run_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      latestSequence: Number(row.latest_sequence),
      historyExpired: row.history_expired,
      sourcesValid: row.sources_valid,
      terminalEventType: row.terminal_event_type,
    };
  }

  assertStreamAllowed(context: AgentStreamContext, lastEventId: number): void {
    if (context.historyExpired) {
      throw new ApiCodeException('EVENT_HISTORY_EXPIRED', 410, 'Event history has expired.');
    }
    if (!context.sourcesValid) {
      throw new ApiCodeException(
        'SOURCE_INVALIDATED',
        409,
        'The run sources are no longer available.',
      );
    }
    if (lastEventId > context.latestSequence) {
      throw new ApiCodeException('INVALID_EVENT_CURSOR', 409, 'The event cursor is invalid.');
    }
  }

  async listEvents(
    auth: AuthContext,
    runId: string,
    afterSequence: number,
    limit = 100,
  ): Promise<AgentRunEvent[]> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<AgentEventRow>('SELECT * FROM app.list_agent_run_events($1, $2, $3)', [
        runId,
        afterSequence,
        limit,
      ]),
    );
    return result.rows.map((row) => mapEvent(row, runId));
  }

  async *streamEvents(
    auth: AuthContext,
    runId: string,
    afterSequence: number,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamChunk> {
    let cursor = afterSequence;
    let lastHeartbeat = Date.now();
    for (;;) {
      if (signal.aborted) return;
      const context = await this.getStreamContext(auth, runId);
      this.assertStreamAllowed(context, cursor);
      const events = await this.listEvents(auth, runId, cursor, 100);
      if (events.length > 0) {
        for (const event of events) {
          cursor = event.sequence;
          yield { data: formatAgentEvent(event), sequence: event.sequence };
        }
        lastHeartbeat = Date.now();
        continue;
      }
      if (context.terminalEventType !== null) return;
      if (Date.now() - lastHeartbeat >= 15000) {
        yield { data: ': heartbeat\n\n' };
        lastHeartbeat = Date.now();
      }
      await sleep(500, signal);
    }
  }

  async cancel(
    auth: AuthContext,
    runId: string,
    idempotencyKey: string,
  ): Promise<AgentCancelResponse & { accepted: boolean }> {
    const requestHash = createHash('sha256').update(JSON.stringify({ runId })).digest('hex');
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<{ run_id: string; status: AgentRunStatus; accepted: boolean }>(
        'SELECT * FROM app.cancel_agent_run($1, $2, $3, $4, $5)',
        [runId, idempotencyKey, 'POST', `/api/v1/agent/runs/${runId}/cancel`, requestHash],
      ),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return {
      ...AgentCancelResponseSchema.parse({ runId: row.run_id, status: row.status }),
      accepted: row.accepted,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
  }
}
