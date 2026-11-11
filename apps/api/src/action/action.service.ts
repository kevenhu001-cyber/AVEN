import { Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  ActionCancelResponseSchema,
  ActionConfirmResponseSchema,
  ActionCreateResponseSchema,
  ActionSchema,
  type Action,
  type ActionCancelResponse,
  type ActionConfirmRequest,
  type ActionConfirmResponse,
  type ActionCreateRequest,
  type ActionCreateResponse,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { randomToken, sha256 } from '../auth/tokens.js';
import { ApiCodeException } from '../http-errors.js';

type ActionRow = {
  id: string;
  action_type: Action['actionType'];
  status: Action['status'];
  draft_version: number;
  run_id: string | null;
  organization_id: string | null;
  draft_payload: Record<string, unknown>;
  expires_at: Date;
  confirmed_at: Date | null;
  executed_at: Date | null;
  result: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

type ActionConfirmRow = ActionRow & { executed: boolean };
type ActionCancelRow = ActionRow & { accepted: boolean };

function mapAction(row: ActionRow): Action {
  return ActionSchema.parse({
    id: row.id,
    actionType: row.action_type,
    status: row.status,
    draftVersion: row.draft_version,
    runId: row.run_id,
    organizationId: row.organization_id,
    preview: row.draft_payload,
    expiresAt: row.expires_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    executedAt: row.executed_at?.toISOString() ?? null,
    result: row.result,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

@Injectable()
export class ActionService implements OnModuleDestroy {
  private pool: DatabasePool | undefined;

  private getPool(): DatabasePool {
    this.pool ??= createApplicationPool({ max: 5 });
    return this.pool;
  }

  private context(auth: AuthContext) {
    return { principalId: auth.principalId, userId: auth.userId };
  }

  async create(auth: AuthContext, input: ActionCreateRequest): Promise<ActionCreateResponse> {
    const token = randomToken();
    const tokenHash = sha256(token);
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<ActionRow>('SELECT * FROM app.create_action($1, $2, $3, $4, $5)', [
        input.actionType,
        input.payload,
        input.runId ?? null,
        input.expiresInSeconds,
        tokenHash,
      ]),
    );
    const row = result.rows[0];
    if (!row) throw new Error('ACTION_CREATE_FAILED');
    return ActionCreateResponseSchema.parse({
      ...mapAction(row),
      confirmationToken: token,
    });
  }

  async get(auth: AuthContext, id: string): Promise<Action> {
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<ActionRow>('SELECT * FROM app.get_action($1)', [id]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return mapAction(row);
  }

  async confirm(
    auth: AuthContext,
    id: string,
    input: ActionConfirmRequest,
    idempotencyKey: string,
  ): Promise<ActionConfirmResponse> {
    const tokenHash = sha256(input.confirmationToken);
    const requestHash = sha256(
      JSON.stringify({
        actionId: id,
        expectedDraftVersion: input.expectedDraftVersion,
        tokenHash,
      }),
    );
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<ActionConfirmRow>(
        'SELECT * FROM app.confirm_memory_create_action($1, $2, $3, $4, $5, $6, $7)',
        [
          id,
          input.expectedDraftVersion,
          tokenHash,
          idempotencyKey,
          'POST',
          `/api/v1/actions/${id}/confirm`,
          requestHash,
        ],
      ),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    if (row.status === 'expired') {
      throw new ApiCodeException('ACTION_EXPIRED', 409, 'The action has expired.');
    }
    if (row.status === 'cancelled' || row.status === 'failed') {
      throw new ApiCodeException('ACTION_NOT_CONFIRMABLE', 409, 'The action is not confirmable.');
    }
    if (row.status === 'pending_confirmation' && !row.executed) {
      throw new ApiCodeException('ACTION_NOT_CONFIRMABLE', 409, 'The action is not confirmable.');
    }
    return ActionConfirmResponseSchema.parse(mapAction(row));
  }

  async cancel(
    auth: AuthContext,
    id: string,
    idempotencyKey: string,
  ): Promise<ActionCancelResponse> {
    const requestHash = sha256(JSON.stringify({ actionId: id }));
    const result = await withRequestContext(this.getPool(), this.context(auth), async (client) =>
      client.query<ActionCancelRow>('SELECT * FROM app.cancel_action($1, $2, $3, $4, $5)', [
        id,
        idempotencyKey,
        'POST',
        `/api/v1/actions/${id}/cancel`,
        requestHash,
      ]),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    if (row.status === 'succeeded') {
      throw new ApiCodeException('ACTION_NOT_CONFIRMABLE', 409, 'The action has already executed.');
    }
    return ActionCancelResponseSchema.parse(mapAction(row));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
  }
}
