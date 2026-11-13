import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  UserAIProviderMetadataSchema,
  type UserAIProviderInput,
  type UserAIProviderMetadata,
  type UserAIProviderTest,
} from '@aven/contracts';
import {
  AIError,
  OpenAICompatibleProvider,
  decryptProviderKey,
  publicProviderFetch,
} from '@aven/ai-core';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { AuthRateLimiter } from '../auth/rate-limit.js';
import {
  ApiCodeException,
  RateLimitedException,
  ServiceNotReadyException,
} from '../http-errors.js';
import { approvedProviderUrl, encryptProviderKey } from './provider-security.js';

type Row = {
  config_id: string;
  base_url: string;
  model: string;
  version: number;
  updated_at: Date;
};
type Secret = { config_id: string; encrypted_key: string; version: number };
function map(row: Row): UserAIProviderMetadata {
  return UserAIProviderMetadataSchema.parse({
    configId: row.config_id,
    baseUrl: row.base_url,
    model: row.model,
    version: row.version,
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}
@Injectable()
export class UserAIProviderService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;
  private readonly testLimiter = new AuthRateLimiter();
  private getPool(): DatabasePool {
    return (this.pool ??= createApplicationPool());
  }
  async onModuleDestroy(): Promise<void> {
    this.testLimiter.close();
    await this.pool?.end();
  }
  private context(auth: AuthContext) {
    return { userId: auth.userId, principalId: auth.principalId };
  }
  async get(auth: AuthContext): Promise<UserAIProviderMetadata | null> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const result = await client.query<Row>('SELECT * FROM app.get_user_ai_provider_metadata()');
      return result.rows[0] ? map(result.rows[0]) : null;
    });
  }
  private async secret(auth: AuthContext, input: UserAIProviderInput): Promise<string> {
    if (input.apiKey) return input.apiKey;
    const row = await withRequestContext(
      this.getPool(),
      this.context(auth),
      async (client) =>
        (await client.query<Secret>('SELECT * FROM app.get_user_ai_provider_secret()')).rows[0],
    );
    if (!row) throw new UnprocessableEntityException('An API key is required for a new provider.');
    if (row.config_id !== input.expectedConfigId || row.version !== input.expectedVersion)
      throw new ApiCodeException('VERSION_CONFLICT', 409, 'Provider configuration changed.');
    try {
      return decryptProviderKey(row.encrypted_key, auth.userId, process.env.AI_USER_CONFIG_KEY);
    } catch {
      throw new ServiceNotReadyException('Provider credentials unavailable.');
    }
  }
  async save(auth: AuthContext, input: UserAIProviderInput): Promise<UserAIProviderMetadata> {
    const baseUrl = approvedProviderUrl(input.baseUrl, process.env.AI_USER_ALLOWED_BASE_URLS);
    const secret = await this.secret(auth, input);
    const encryptedKey = encryptProviderKey(secret, auth.userId, process.env.AI_USER_CONFIG_KEY);
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const result = await client.query<Row>(
        'SELECT * FROM app.save_user_ai_provider_checked($1,$2,$3,$4,$5)',
        [baseUrl, input.model, encryptedKey, input.expectedVersion, input.expectedConfigId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('PROVIDER_CONFIG_SAVE_FAILED');
      return map(row);
    });
  }
  async test(auth: AuthContext, input: UserAIProviderInput): Promise<UserAIProviderTest> {
    const baseUrl = approvedProviderUrl(input.baseUrl, process.env.AI_USER_ALLOWED_BASE_URLS);
    let limit;
    try {
      limit = await this.testLimiter.consume('provider:test', auth.userId, 5, 60);
    } catch {
      throw new ServiceNotReadyException('Connection test limiter unavailable.', true);
    }
    if (!limit.allowed) throw new RateLimitedException(limit.retryAfter);
    const secret = await this.secret(auth, input);
    const provider = new OpenAICompatibleProvider({
      baseUrl,
      model: input.model,
      apiKey: secret,
      timeoutMs: 15000,
      fetch: publicProviderFetch,
    });
    const signal = AbortSignal.timeout(15000);
    try {
      let answer = '',
        completed = false;
      for await (const event of provider.streamText({
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        maxTokens: 512,
        signal,
      })) {
        if (event.type === 'error')
          return { ok: false, errorCode: signal.aborted ? 'PROVIDER_TIMEOUT' : event.error.code };
        if (event.type === 'text_delta') answer += event.text;
        if (event.type === 'done') completed = true;
      }
      return completed && answer.trim()
        ? { ok: true }
        : { ok: false, errorCode: 'PROVIDER_INVALID_OUTPUT' };
    } catch (error) {
      return {
        ok: false,
        errorCode: error instanceof AIError ? error.code : 'PROVIDER_UNAVAILABLE',
      };
    }
  }

  async delete(auth: AuthContext, version: number, configId: string): Promise<boolean> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const result = await client.query<{ deleted: boolean }>(
        'SELECT app.delete_user_ai_provider_checked($1,$2) AS deleted',
        [version, configId],
      );
      return result.rows[0]?.deleted ?? false;
    });
  }
}
