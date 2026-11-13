import {
  AIError,
  OpenAICompatibleProvider,
  decryptProviderKey,
  publicProviderFetch,
  publicProviderUrl,
} from '@aven/ai-core';
import type { DatabasePool } from '@aven/database';
export async function userProviderForRun(pool: DatabasePool, runId: string) {
  const result = await pool.query<{
    user_id: string;
    base_url: string;
    model: string;
    encrypted_key: string;
  }>('SELECT * FROM app.get_agent_run_user_provider($1)', [runId]);
  const row = result.rows[0];
  if (!row)
    throw new AIError(
      'PROVIDER_NOT_CONFIGURED',
      'Personal provider configuration changed or was deleted.',
    );
  const baseUrl = publicProviderUrl(row.base_url);
  const key = decryptProviderKey(row.encrypted_key, row.user_id, process.env.AI_USER_CONFIG_KEY);
  return new OpenAICompatibleProvider({
    baseUrl,
    apiKey: key,
    model: row.model,
    timeoutMs: 60000,
    fetch: publicProviderFetch,
  });
}
