import {
  ForbiddenException,
  UnprocessableEntityException,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import { AdminConfigMetadataSchema, type AdminConfigInput } from '@aven/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { approvedProviderUrl, encryptProviderKey } from '../ai-provider/provider-security.js';

@Injectable()
export class AdminService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;
  async onModuleDestroy() {
    await this.pool?.end();
  }
  private context<T>(auth: AuthContext, run: Parameters<typeof withRequestContext<T>>[2]) {
    return withRequestContext(
      (this.pool ??= createApplicationPool()),
      {
        userId: auth.userId,
        principalId: auth.principalId,
      },
      run,
    );
  }
  async list(auth: AuthContext) {
    return this.context(auth, async (client) => {
      const result = await client.query('SELECT * FROM app.get_platform_configurations()');
      return result.rows.map((r) =>
        AdminConfigMetadataSchema.parse({
          kind: r.kind,
          baseUrl: r.base_url,
          model: r.model,
          version: r.version,
          updatedAt: new Date(r.updated_at).toISOString(),
        }),
      );
    });
  }
  async save(auth: AuthContext, kind: string, input: AdminConfigInput) {
    return this.context(auth, async (client) => {
      const check = await client.query<{ allowed: boolean }>(
        'SELECT app.is_platform_admin() AS allowed',
      );
      if (!check.rows[0]?.allowed) throw new ForbiddenException();
      if (kind === 'model' && !input.model.trim()) throw new UnprocessableEntityException();
      const baseUrl = approvedProviderUrl(
        input.baseUrl,
        kind === 'model'
          ? process.env.AI_USER_ALLOWED_BASE_URLS
          : process.env.OPEN_CONNECTOR_ALLOWED_BASE_URLS,
      );
      const key = encryptProviderKey(
        input.apiKey,
        `platform:${kind}`,
        process.env.AI_USER_CONFIG_KEY,
      );
      await client.query('SELECT * FROM app.save_platform_configuration($1,$2,$3,$4,$5)', [
        kind,
        baseUrl,
        input.model,
        key,
        input.expectedVersion,
      ]);
      return { saved: true };
    });
  }
}
