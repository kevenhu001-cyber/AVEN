import { ConflictException, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';

@Injectable()
export class NotificationService implements OnModuleDestroy {
  private pool: DatabasePool | null = null;
  private async execute(auth: AuthContext, sql: string, args: unknown[] = []): Promise<unknown> {
    this.pool ??= createApplicationPool();
    return withRequestContext(
      this.pool,
      { userId: auth.userId, principalId: auth.principalId },
      async (client) => {
        try {
          const result = await client.query<{ result: unknown }>(sql, args);
          return result.rows[0]?.result;
        } catch (error) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '40001'
          )
            throw new ConflictException('Notification state changed.');
          throw error;
        }
      },
    );
  }
  list(auth: AuthContext, limit: number, at: string | null, id: string | null) {
    return this.execute(auth, 'SELECT app.list_notifications($1,$2,$3) AS result', [limit, at, id]);
  }
  preferences(auth: AuthContext) {
    return this.execute(auth, 'SELECT app.get_notification_preferences() AS result');
  }
  updatePreferences(
    auth: AuthContext,
    input: { connectionInvitations: boolean; connectionUpdates: boolean; expectedVersion: number },
  ) {
    return this.execute(auth, 'SELECT app.update_notification_preferences($1,$2,$3) AS result', [
      input.connectionInvitations,
      input.connectionUpdates,
      input.expectedVersion,
    ]);
  }
  read(auth: AuthContext, id: string) {
    return this.execute(auth, 'SELECT app.read_notification($1) AS result', [id]);
  }
  dead(auth: AuthContext) {
    return this.execute(auth, 'SELECT app.list_dead_notifications() AS result');
  }
  retry(auth: AuthContext, id: string, generation: number) {
    return this.execute(auth, 'SELECT app.retry_notification_delivery($1,$2) AS result', [
      id,
      generation,
    ]);
  }
  async onModuleDestroy() {
    await this.pool?.end();
    this.pool = null;
  }
}
