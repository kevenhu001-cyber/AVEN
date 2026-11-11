import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  UserAIProviderMetadataSchema,
  type UserAIProviderInput,
  type UserAIProviderMetadata,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { approvedProviderUrl, encryptProviderKey } from './provider-security.js';

type Row = { base_url: string; model: string; version: number; updated_at: Date };
function map(row: Row): UserAIProviderMetadata {
  return UserAIProviderMetadataSchema.parse({
    baseUrl: row.base_url,
    model: row.model,
    version: row.version,
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}
@Injectable()
export class UserAIProviderService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;
  private getPool(): DatabasePool {
    return (this.pool ??= createApplicationPool());
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
  async get(auth: AuthContext): Promise<UserAIProviderMetadata | null> {
    return withRequestContext(
      this.getPool(),
      { userId: auth.userId, principalId: auth.principalId },
      async (client) => {
        const result = await client.query<Row>('SELECT * FROM app.get_user_ai_provider()');
        return result.rows[0] ? map(result.rows[0]) : null;
      },
    );
  }
  async save(auth: AuthContext, input: UserAIProviderInput): Promise<UserAIProviderMetadata> {
    const baseUrl = approvedProviderUrl(input.baseUrl, process.env.AI_USER_ALLOWED_BASE_URLS);
    const encryptedKey = encryptProviderKey(
      input.apiKey,
      auth.userId,
      process.env.AI_USER_CONFIG_KEY,
    );
    return withRequestContext(
      this.getPool(),
      { userId: auth.userId, principalId: auth.principalId },
      async (client) => {
        const result = await client.query<Row>(
          'SELECT * FROM app.save_user_ai_provider($1, $2, $3, $4)',
          [baseUrl, input.model, encryptedKey, input.expectedVersion],
        );
        const row = result.rows[0];
        if (!row) throw new Error('PROVIDER_CONFIG_SAVE_FAILED');
        return map(row);
      },
    );
  }
  async delete(auth: AuthContext, version: number): Promise<boolean> {
    return withRequestContext(
      this.getPool(),
      { userId: auth.userId, principalId: auth.principalId },
      async (client) => {
        const result = await client.query<{ deleted: boolean }>(
          'SELECT app.delete_user_ai_provider($1) AS deleted',
          [version],
        );
        return result.rows[0]?.deleted ?? false;
      },
    );
  }
}
