import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  CalendarConnectAuthorizeResponseSchema,
  CalendarConnectionSummarySchema,
  CalendarRevokeResponseSchema,
  CalendarSyncResultSchema,
  type CalendarConnectAuthorizeRequest,
  type CalendarConnectAuthorizeResponse,
  type CalendarConnectCallbackRequest,
  type CalendarConnectionStatus,
  type CalendarConnectionSummary,
  type CalendarOAuthProvider,
  type CalendarRevokeResponse,
  type CalendarSyncRequest,
  type CalendarSyncResult,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiCodeException } from '../http-errors.js';
import {
  decryptCalendarTokenPayload,
  encryptCalendarTokenPayload,
  signCalendarOAuthState,
  verifyCalendarOAuthState,
} from './calendar-crypto.js';
import {
  CALENDAR_OAUTH_ADAPTER,
  CalendarAdapterError,
  MockCalendarOAuthAdapter,
  type CalendarOAuthAdapter,
} from './calendar-oauth.adapter.js';

export const CALENDAR_ENCRYPTION_KEY = Symbol('CALENDAR_ENCRYPTION_KEY');
export const CALENDAR_DATABASE_POOL = Symbol('CALENDAR_DATABASE_POOL');

type ConnectionSummaryRow = {
  id: string;
  principal_id: string;
  provider: CalendarOAuthProvider;
  key_version: number;
  sync_cursor: string | null;
  status: CalendarConnectionStatus;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ConnectionSecretRow = {
  id: string;
  principal_id: string;
  provider: CalendarOAuthProvider;
  credentials_ciphertext: string;
  key_version: number;
  sync_cursor: string | null;
  status: CalendarConnectionStatus;
  last_synced_at: Date | string | null;
};

type ApplyDeltaRow = {
  imported_count: number;
  deleted_count: number;
  next_cursor: string | null;
  last_synced_at: Date | string;
};

function mapSummary(row: ConnectionSummaryRow): CalendarConnectionSummary {
  return CalendarConnectionSummarySchema.parse({
    id: row.id,
    provider: row.provider,
    status: row.status,
    keyVersion: row.key_version,
    syncCursor: row.sync_cursor ?? null,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function defaultRedirectUri(provider: CalendarOAuthProvider): string {
  const webOrigin = process.env.WEB_ORIGIN?.trim() || 'https://app.aven.example.com';
  return `${webOrigin.replace(/\/$/, '')}/calendar/oauth/callback/${provider}`;
}

@Injectable()
export class CalendarConnectionService implements OnModuleDestroy {
  private pool: DatabasePool | null = null;
  private readonly ownPool: boolean;
  private readonly adapter: CalendarOAuthAdapter;

  constructor(
    @Optional() @Inject(CALENDAR_OAUTH_ADAPTER) adapter?: CalendarOAuthAdapter,
    @Optional() @Inject(CALENDAR_ENCRYPTION_KEY) private readonly encryptionKey?: string,
    @Optional() @Inject(CALENDAR_DATABASE_POOL) externalPool?: DatabasePool,
  ) {
    this.adapter = adapter ?? new MockCalendarOAuthAdapter();
    if (externalPool) {
      this.pool = externalPool;
      this.ownPool = false;
    } else {
      this.ownPool = true;
    }
  }

  private getPool(): DatabasePool {
    if (!this.pool) {
      this.pool = createApplicationPool();
    }
    return this.pool;
  }

  private context(auth: AuthContext) {
    return { principalId: auth.principalId, userId: auth.userId };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ownPool && this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async beginAuthorize(
    auth: AuthContext,
    input: CalendarConnectAuthorizeRequest,
  ): Promise<CalendarConnectAuthorizeResponse> {
    const redirectUri = input.redirectUri ?? defaultRedirectUri(input.provider);
    const { stateToken, expiresAt } = signCalendarOAuthState({
      principalId: auth.principalId,
      provider: input.provider,
    });
    const config = await this.adapter.getAuthorizationConfig({
      provider: input.provider,
      stateToken,
      redirectUri,
      ...(input.loginHint !== undefined ? { loginHint: input.loginHint } : {}),
      allowLive: input.allowLive,
    });

    return CalendarConnectAuthorizeResponseSchema.parse({
      provider: input.provider,
      authorizationUrl: config.authorizationUrl,
      stateToken,
      expiresAt,
      scopes: config.scopes,
      providerMode: config.providerMode,
    });
  }

  async handleCallback(
    auth: AuthContext,
    input: CalendarConnectCallbackRequest,
  ): Promise<CalendarConnectionSummary> {
    verifyCalendarOAuthState(input.stateToken, auth.principalId, input.provider);
    const redirectUri = input.redirectUri ?? defaultRedirectUri(input.provider);
    const exchanged = await this.adapter.exchangeCode({
      provider: input.provider,
      code: input.code,
      redirectUri,
      allowLive: input.allowLive,
    });

    const ciphertext = encryptCalendarTokenPayload(
      exchanged.tokens,
      auth.principalId,
      input.provider,
      this.encryptionKey,
      1,
    );

    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<ConnectionSummaryRow>(
        'SELECT * FROM app.upsert_calendar_connection($1, $2, $3, $4)',
        [input.provider, ciphertext, 1, 'active'],
      );
      const row = res.rows[0];
      if (!row) {
        throw new UnprocessableEntityException('Failed to store calendar connection.');
      }
      return mapSummary(row);
    });
  }

  async listConnections(auth: AuthContext): Promise<CalendarConnectionSummary[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<ConnectionSummaryRow>(
        'SELECT * FROM app.list_calendar_connections()',
      );
      return res.rows.map(mapSummary);
    });
  }

  async syncConnection(auth: AuthContext, input: CalendarSyncRequest): Promise<CalendarSyncResult> {
    const now = new Date();
    const windowStart = input.windowStart ?? now.toISOString();
    const windowEnd =
      input.windowEnd ?? new Date(Date.parse(windowStart) + 14 * 24 * 3600_000).toISOString();
    if (Date.parse(windowEnd) - Date.parse(windowStart) > 60 * 24 * 3600_000) {
      throw new UnprocessableEntityException('Calendar sync window cannot exceed 60 days.');
    }

    const conn = await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<ConnectionSecretRow>(
        'SELECT * FROM app.get_calendar_connection_for_sync($1)',
        [input.provider],
      );
      return res.rows[0] ?? null;
    });

    if (!conn) {
      throw new NotFoundException(`No calendar connection found for ${input.provider}.`);
    }
    if (conn.status === 'revoked') {
      throw new ForbiddenException(`Calendar connection for ${input.provider} is revoked.`);
    }

    const tokens = decryptCalendarTokenPayload(
      conn.credentials_ciphertext,
      auth.principalId,
      input.provider,
      this.encryptionKey,
    );

    const initialCursor = input.forceFullSync ? null : (conn.sync_cursor ?? null);
    let recoveredFromExpiredCursor = false;
    let delta: Awaited<ReturnType<CalendarOAuthAdapter['fetchBusyDelta']>>;

    try {
      delta = await this.adapter.fetchBusyDelta({
        provider: input.provider,
        tokens,
        syncCursor: initialCursor,
        windowStart,
        windowEnd,
        allowLive: input.allowLive,
      });
    } catch (error) {
      if (error instanceof CalendarAdapterError && error.code === 'SYNC_CURSOR_EXPIRED') {
        recoveredFromExpiredCursor = true;
        delta = await this.adapter.fetchBusyDelta({
          provider: input.provider,
          tokens,
          syncCursor: null,
          windowStart,
          windowEnd,
          allowLive: input.allowLive,
        });
      } else if (error instanceof CalendarAdapterError && error.code === 'TOKEN_REVOKED') {
        await withRequestContext(this.getPool(), this.context(auth), async (client) => {
          await client.query('SELECT app.update_calendar_connection_state($1, $2)', [
            input.provider,
            'reauth_required',
          ]);
        });
        throw new UnauthorizedException('External calendar authorization expired or was revoked.');
      } else if (error instanceof CalendarAdapterError && error.code === 'UPSTREAM_UNAVAILABLE') {
        await withRequestContext(this.getPool(), this.context(auth), async (client) => {
          await client.query('SELECT app.update_calendar_connection_state($1, $2)', [
            input.provider,
            'sync_error',
          ]);
        });
        throw new ApiCodeException(
          'PROVIDER_UNAVAILABLE',
          HttpStatus.SERVICE_UNAVAILABLE,
          'External calendar provider temporarily unavailable.',
          true,
        );
      } else {
        throw error;
      }
    }

    const refreshedCiphertext = delta.refreshedTokens
      ? encryptCalendarTokenPayload(
          delta.refreshedTokens,
          auth.principalId,
          input.provider,
          this.encryptionKey,
          conn.key_version,
        )
      : null;

    // Privacy-preserving projection: persist ONLY busy/free time ranges and status.
    const sanitizedBlocks = delta.blocks.map((block) => ({
      startAt: block.startAt,
      endAt: block.endAt,
      timezone: block.timezone || 'Asia/Shanghai',
      status: block.status,
    }));

    const applied = await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      if (refreshedCiphertext) {
        await client.query('SELECT app.update_calendar_connection_state($1, $2, $3, $4)', [
          input.provider,
          'active',
          refreshedCiphertext,
          conn.key_version,
        ]);
      }
      const res = await client.query<ApplyDeltaRow>(
        'SELECT * FROM app.apply_calendar_sync_delta($1, $2, $3::jsonb, $4)',
        [input.provider, delta.nextCursor, JSON.stringify(sanitizedBlocks), true],
      );
      return res.rows[0];
    });

    if (!applied) {
      throw new UnprocessableEntityException('Failed to apply calendar sync delta.');
    }

    return CalendarSyncResultSchema.parse({
      provider: input.provider,
      status: 'active',
      providerMode: delta.providerMode,
      importedBlocksCount: Number(applied.imported_count),
      deletedBlocksCount: Number(applied.deleted_count),
      previousCursor: initialCursor,
      nextCursor: applied.next_cursor ?? null,
      recoveredFromExpiredCursor,
      lastSyncedAt: new Date(applied.last_synced_at).toISOString(),
      privacyNotice: '仅同步忙闲时间段，不保存外部日程标题、备注或参与者详情。',
    });
  }

  async revokeConnection(
    auth: AuthContext,
    provider: CalendarOAuthProvider,
  ): Promise<CalendarRevokeResponse> {
    try {
      const deletedCount = await withRequestContext(
        this.getPool(),
        this.context(auth),
        async (client) => {
          const res = await client.query<{ revoke_calendar_connection: number }>(
            'SELECT app.revoke_calendar_connection($1) AS revoke_calendar_connection',
            [provider],
          );
          return res.rows[0]?.revoke_calendar_connection ?? 0;
        },
      );
      return CalendarRevokeResponseSchema.parse({
        provider,
        revoked: true,
        deletedSyncedBlocksCount: Number(deletedCount),
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P0002') {
        throw new NotFoundException(`No calendar connection found for ${provider}.`);
      }
      throw error;
    }
  }
}
