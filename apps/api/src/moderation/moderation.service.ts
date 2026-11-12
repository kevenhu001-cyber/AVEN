import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  createApplicationPool,
  withRequestContext,
  type DatabasePool,
  type DatabaseClient,
} from '@aven/database';
import type { BlockUserRequest, SubmitReportRequest } from '@aven/contracts';
import type { AuthContext } from '../auth/auth.types.js';

@Injectable()
export class ModerationService implements OnModuleDestroy {
  private pool: DatabasePool | null = null;

  private async transaction<T>(auth: AuthContext, work: (client: DatabaseClient) => Promise<T>) {
    this.pool ??= createApplicationPool();
    return withRequestContext(
      this.pool,
      { userId: auth.userId, principalId: auth.principalId },
      async (client) => work(client),
    );
  }

  private execute(auth: AuthContext, sql: string, values: unknown[] = []): Promise<unknown> {
    return this.transaction(auth, async (client) => {
      const result = await client.query<{ result: unknown }>(sql, values);
      return result.rows[0]?.result;
    });
  }

  async blockUser(auth: AuthContext, input: BlockUserRequest) {
    return this.execute(auth, 'SELECT app.block_user($1::uuid, $2) AS result', [
      input.blockedUserId,
      input.reason ?? null,
    ]);
  }

  async unblockUser(auth: AuthContext, blockedUserId: string) {
    const unblocked = await this.execute(auth, 'SELECT app.unblock_user($1::uuid) AS result', [
      blockedUserId,
    ]);
    return { unblocked: Boolean(unblocked) };
  }

  async listBlocks(auth: AuthContext) {
    return this.execute(auth, 'SELECT app.list_blocks() AS result');
  }

  async submitReport(auth: AuthContext, input: SubmitReportRequest) {
    return this.execute(auth, 'SELECT app.submit_report($1, $2::uuid, $3, $4) AS result', [
      input.targetType,
      input.targetId,
      input.reason,
      input.details ?? null,
    ]);
  }

  async listReports(auth: AuthContext) {
    return this.execute(auth, 'SELECT app.list_my_reports() AS result');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
