import { ConflictException, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { CreateConnectionPreviewRequest } from '@aven/contracts';
import {
  createApplicationPool,
  withRequestContext,
  type DatabasePool,
  type DatabaseClient,
} from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';

@Injectable()
export class ConnectionService implements OnModuleDestroy {
  private pool: DatabasePool | null = null;
  private async transaction<T>(auth: AuthContext, work: (client: DatabaseClient) => Promise<T>) {
    this.pool ??= createApplicationPool();
    return withRequestContext(
      this.pool,
      { userId: auth.userId, principalId: auth.principalId },
      async (client) => {
        try {
          return await work(client);
        } catch (error) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '40001'
          ) {
            throw new ConflictException('Connection request conflicts with the current state.');
          }
          throw error;
        }
      },
    );
  }
  private execute(auth: AuthContext, sql: string, values: unknown[] = []): Promise<unknown> {
    return this.transaction(auth, async (client) => {
      const result = await client.query<{ result: unknown }>(sql, values);
      return result.rows[0]?.result;
    });
  }
  widget(auth: AuthContext, id: string) {
    return this.transaction(auth, async (client) => {
      // Snapshot locks remain held until metadata has been read and this transaction commits.
      const snapshot = await client.query<{ items: unknown }>(
        'SELECT app.connection_snapshot($1) AS items',
        [id],
      );
      const invitation = await client.query<{ result: unknown; sender: boolean }>(
        "SELECT result, result->>'senderUserId' = $2 AS sender FROM (SELECT app.get_connection_invitation($1) AS result) AS invitation",
        [id, auth.userId],
      );
      return {
        kind: 'connection_invitation',
        role: invitation.rows[0]?.sender ? 'sender' : 'recipient',
        invitation: invitation.rows[0]?.result,
        snapshot: { invitationId: id, items: snapshot.rows[0]?.items },
      };
    });
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }
  preview(auth: AuthContext, input: CreateConnectionPreviewRequest) {
    return this.execute(auth, 'SELECT app.create_connection_preview($1,$2::uuid[],$3) AS result', [
      input.recipientUserId,
      input.memoryItemIds,
      input.expiresInDays,
    ]);
  }
  send(auth: AuthContext, previewId: string, key: string) {
    return this.execute(auth, 'SELECT app.send_connection_invitation($1,$2) AS result', [
      previewId,
      key,
    ]);
  }
  list(auth: AuthContext) {
    return this.execute(auth, 'SELECT app.list_connection_invitations() AS result');
  }
  connections(auth: AuthContext) {
    return this.execute(auth, 'SELECT app.list_peer_connections() AS result');
  }
  get(auth: AuthContext, id: string) {
    return this.execute(auth, 'SELECT app.get_connection_invitation($1) AS result', [id]);
  }
  snapshot(auth: AuthContext, id: string) {
    return this.execute(auth, 'SELECT app.connection_snapshot($1) AS result', [id]);
  }
  decide(auth: AuthContext, id: string, decision: string, version: number) {
    return this.execute(auth, 'SELECT app.decide_connection_invitation($1,$2,$3) AS result', [
      id,
      decision,
      version,
    ]);
  }
  revoke(auth: AuthContext, id: string, withdraw: boolean, version: number | null) {
    return this.execute(auth, 'SELECT app.revoke_connection_invitation($1,$2,$3) AS result', [
      id,
      withdraw,
      version,
    ]);
  }
}
