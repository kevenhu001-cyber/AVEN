import type { PoolClient } from 'pg';
import {
  AgentHistoryQuerySchema,
  AgentHistorySchema,
  type AgentHistoryQuery,
} from '@aven/contracts';

/** Must run inside withRequestContext on aven_app; RLS remains active. */
export async function listPersonalAgentHistory(client: PoolClient, input: AgentHistoryQuery) {
  const query = AgentHistoryQuerySchema.parse(input);
  const result = await client.query<{
    id: string;
    conversation_id: string;
    status: string;
    provider: string;
    model: string;
    created_at: Date;
  }>(
    `SELECT r.id, r.conversation_id, r.status, r.provider, r.model, r.created_at
      FROM public.agent_runs r
      JOIN public.conversations c ON c.id = r.conversation_id
      WHERE r.initiated_by_user_id = app.current_user_id()
        AND c.owner_user_id = app.current_user_id() AND c.organization_id IS NULL
        AND ($1::timestamptz IS NULL OR (r.created_at, r.id) < ($1::timestamptz, $2::uuid))
      ORDER BY r.created_at DESC, r.id DESC LIMIT $3`,
    [query.cursorCreatedAt ?? null, query.cursorId ?? null, query.limit + 1],
  );
  const data = result.rows.slice(0, query.limit).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at.toISOString(),
  }));
  const last = data.at(-1);
  return AgentHistorySchema.parse({
    data,
    nextCursor:
      result.rows.length > query.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  });
}
