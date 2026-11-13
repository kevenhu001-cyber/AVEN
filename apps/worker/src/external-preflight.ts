import { withRequestContext, type DatabasePool } from '@aven/database';
export type ExternalRunIdentity = { runId: string; userId: string; principalId: string };
export async function authorizeExternalRun(
  pool: DatabasePool,
  identity: ExternalRunIdentity,
): Promise<boolean> {
  if (identity.principalId !== identity.userId) return false;
  return withRequestContext(
    pool,
    { userId: identity.userId, principalId: identity.principalId, requestId: identity.runId },
    async (client) => {
      const result = await client.query<{
        sources_valid: boolean;
        history_expired: boolean;
        status: string;
      }>('SELECT * FROM app.get_agent_run_stream_context($1)', [identity.runId]);
      const row = result.rows[0];
      return Boolean(row?.sources_valid && !row.history_expired && row.status === 'running');
    },
  );
}
