import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiCodeException } from '../http-errors.js';
import {
  decryptCalendarTokenPayload,
  encryptCalendarTokenPayload,
  signCalendarOAuthState,
  verifyCalendarOAuthState,
} from './calendar-crypto.js';
import {
  CalendarAdapterError,
  MockCalendarOAuthAdapter,
  type CalendarOAuthAdapter,
} from './calendar-oauth.adapter.js';
import { CalendarConnectionService } from './calendar-connection.service.js';

type StoredConn = {
  id: string;
  principal_id: string;
  provider: string;
  credentials_ciphertext: string;
  key_version: number;
  sync_cursor: string | null;
  status: string;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function createFakeCalendarPool() {
  const conns = new Map<string, StoredConn>();
  const syncedBlocks = new Map<string, Array<Record<string, unknown>>>();
  let currentPrincipalId: string | null = null;

  const client = {
    async query(sql: string, params: unknown[] = []) {
      const normalized = sql.trim();
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('set_config') && normalized.includes('app.principal_id')) {
        currentPrincipalId = String(params[0] ?? '');
        return { rows: [] };
      }
      if (normalized.includes('set_config')) {
        return { rows: [] };
      }
      if (normalized.includes('app.upsert_calendar_connection')) {
        const [provider, ciphertext, keyVersion, status] = params as [
          string,
          string,
          number,
          string,
        ];
        const key = `${currentPrincipalId}:${provider}`;
        const existing = conns.get(key);
        const now = new Date();
        const record: StoredConn = {
          id: existing?.id ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          principal_id: currentPrincipalId!,
          provider,
          credentials_ciphertext: ciphertext,
          key_version: keyVersion,
          sync_cursor: existing?.status === 'revoked' ? null : (existing?.sync_cursor ?? null),
          status,
          last_synced_at: existing?.last_synced_at ?? null,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
        conns.set(key, record);
        return {
          rows: [
            {
              id: record.id,
              principal_id: record.principal_id,
              provider: record.provider,
              key_version: record.key_version,
              sync_cursor: record.sync_cursor,
              status: record.status,
              last_synced_at: record.last_synced_at,
              created_at: record.created_at,
              updated_at: record.updated_at,
            },
          ],
        };
      }
      if (normalized.includes('app.list_calendar_connections')) {
        const rows = [...conns.values()]
          .filter((c) => c.principal_id === currentPrincipalId)
          .map(({ credentials_ciphertext: _omit, ...rest }) => rest);
        return { rows };
      }
      if (normalized.includes('app.get_calendar_connection_for_sync')) {
        const [provider] = params as [string];
        const rec = conns.get(`${currentPrincipalId}:${provider}`);
        return { rows: rec ? [rec] : [] };
      }
      if (normalized.includes('app.update_calendar_connection_state')) {
        const [provider, nextStatus, nextCipher, nextKeyVer] = params as [
          string,
          string,
          string | undefined,
          number | undefined,
        ];
        const rec = conns.get(`${currentPrincipalId}:${provider}`);
        if (rec) {
          rec.status = nextStatus;
          if (nextCipher) rec.credentials_ciphertext = nextCipher;
          if (nextKeyVer) rec.key_version = nextKeyVer;
          rec.updated_at = new Date();
        }
        return { rows: [{ update_calendar_connection_state: Boolean(rec) }] };
      }
      if (normalized.includes('app.apply_calendar_sync_delta')) {
        const [provider, nextCursor, blocksJson, replaceExisting] = params as [
          string,
          string,
          string,
          boolean,
        ];
        const key = `${currentPrincipalId}:${provider}`;
        const rec = conns.get(key);
        if (!rec) {
          const err = Object.assign(new Error('not found'), { code: 'P0002' });
          throw err;
        }
        const prev = syncedBlocks.get(key) ?? [];
        const deleted = replaceExisting ? prev.length : 0;
        const incoming = JSON.parse(blocksJson) as Array<Record<string, unknown>>;
        syncedBlocks.set(key, replaceExisting ? incoming : [...prev, ...incoming]);
        const now = new Date();
        rec.sync_cursor = nextCursor;
        rec.status = 'active';
        rec.last_synced_at = now;
        rec.updated_at = now;
        return {
          rows: [
            {
              imported_count: incoming.length,
              deleted_count: deleted,
              next_cursor: nextCursor,
              last_synced_at: now,
            },
          ],
        };
      }
      if (normalized.includes('app.revoke_calendar_connection')) {
        const [provider] = params as [string];
        const key = `${currentPrincipalId}:${provider}`;
        const rec = conns.get(key);
        if (!rec) {
          const err = Object.assign(new Error('not found'), { code: 'P0002' });
          throw err;
        }
        rec.status = 'revoked';
        rec.credentials_ciphertext = '[REVOKED]';
        rec.sync_cursor = null;
        rec.updated_at = new Date();
        const removed = (syncedBlocks.get(key) ?? []).length;
        syncedBlocks.delete(key);
        return { rows: [{ revoke_calendar_connection: removed }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  return {
    conns,
    syncedBlocks,
    pool: {
      async connect() {
        return client;
      },
      async end() {},
    } as unknown as DatabasePool,
  };
}

const TEST_USER_A: AuthContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  principalId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'sess-1',
  transport: 'web',
};

const TEST_USER_B: AuthContext = {
  userId: '22222222-2222-4222-8222-222222222222',
  principalId: '22222222-2222-4222-8222-222222222222',
  sessionId: 'sess-2',
  transport: 'mobile',
};

describe('M6-02 calendar OAuth crypto & connection service', () => {
  it('encrypts/decrypts credentials with AES-256-GCM AAD binding and verifies OAuth state', () => {
    const key = randomBytes(32).toString('base64');
    const cipher = encryptCalendarTokenPayload(
      {
        accessToken: 'secret-access-token',
        refreshToken: 'secret-refresh-token',
        expiresAt: '2026-11-13T10:00:00.000Z',
        tokenType: 'Bearer',
      },
      TEST_USER_A.principalId,
      'google_calendar',
      key,
    );
    expect(cipher).not.toContain('secret-access-token');

    const decoded = decryptCalendarTokenPayload(
      cipher,
      TEST_USER_A.principalId,
      'google_calendar',
      key,
    );
    expect(decoded.accessToken).toBe('secret-access-token');

    expect(() =>
      decryptCalendarTokenPayload(cipher, TEST_USER_B.principalId, 'google_calendar', key),
    ).toThrow();

    const { stateToken } = signCalendarOAuthState({
      principalId: TEST_USER_A.principalId,
      provider: 'google_calendar',
    });
    expect(() =>
      verifyCalendarOAuthState(stateToken, TEST_USER_A.principalId, 'google_calendar'),
    ).not.toThrow();
    expect(() =>
      verifyCalendarOAuthState(stateToken, TEST_USER_B.principalId, 'google_calendar'),
    ).toThrow(UnauthorizedException);
  });

  it('completes authorize -> callback -> sync -> revoke lifecycle without leaking secrets or titles', async () => {
    const key = randomBytes(32).toString('base64');
    const fake = createFakeCalendarPool();
    const service = new CalendarConnectionService(new MockCalendarOAuthAdapter(), key, fake.pool);

    const authz = await service.beginAuthorize(TEST_USER_A, {
      provider: 'google_calendar',
      allowLive: false,
    });
    expect(authz.providerMode).toBe('mock');
    expect(authz.authorizationUrl).toContain('accounts.google.com');

    const summary = await service.handleCallback(TEST_USER_A, {
      provider: 'google_calendar',
      code: 'mock-auth-code-1234',
      stateToken: authz.stateToken,
      allowLive: false,
    });
    expect(summary.status).toBe('active');
    expect(JSON.stringify(summary)).not.toContain('mock-access');

    const list = await service.listConnections(TEST_USER_A);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('credentials');

    const syncRes = await service.syncConnection(TEST_USER_A, {
      provider: 'google_calendar',
      windowStart: '2026-11-12T00:00:00.000Z',
      windowEnd: '2026-11-15T00:00:00.000Z',
      forceFullSync: false,
      allowLive: false,
    });
    expect(syncRes.importedBlocksCount).toBe(2);
    expect(syncRes.nextCursor).toBe('mock-cursor:google_calendar:1');

    const storedBlocks = fake.syncedBlocks.get(`${TEST_USER_A.principalId}:google_calendar`) ?? [];
    expect(storedBlocks).toHaveLength(2);
    expect(Object.keys(storedBlocks[0] ?? {})).toEqual(['startAt', 'endAt', 'timezone', 'status']);

    const revoked = await service.revokeConnection(TEST_USER_A, 'google_calendar');
    expect(revoked.revoked).toBe(true);
    expect(revoked.deletedSyncedBlocksCount).toBe(2);

    await expect(
      service.syncConnection(TEST_USER_A, {
        provider: 'google_calendar',
        forceFullSync: false,
        allowLive: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recovers from expired sync cursor, marks reauth_required on revoked upstream token, and fails closed when allowLive=true', async () => {
    const key = randomBytes(32).toString('base64');
    const fake = createFakeCalendarPool();
    let failMode: 'none' | 'expired_cursor_once' | 'token_revoked' = 'expired_cursor_once';

    const mockBase = new MockCalendarOAuthAdapter();
    const adapter: CalendarOAuthAdapter = {
      getAuthorizationConfig: (input) => mockBase.getAuthorizationConfig(input),
      exchangeCode: (input) => mockBase.exchangeCode(input),
      async fetchBusyDelta(input) {
        if (failMode === 'expired_cursor_once' && input.syncCursor !== null) {
          failMode = 'none';
          throw new CalendarAdapterError('SYNC_CURSOR_EXPIRED', 'Sync token expired (410)');
        }
        if (failMode === 'token_revoked') {
          throw new CalendarAdapterError('TOKEN_REVOKED', 'Refresh token revoked');
        }
        return mockBase.fetchBusyDelta(input);
      },
    };

    const service = new CalendarConnectionService(adapter, key, fake.pool);
    const { stateToken } = await service.beginAuthorize(TEST_USER_A, {
      provider: 'feishu_calendar',
      allowLive: false,
    });
    await service.handleCallback(TEST_USER_A, {
      provider: 'feishu_calendar',
      code: 'feishu-code-9999',
      stateToken,
      allowLive: false,
    });

    // Seed an existing cursor so SYNC_CURSOR_EXPIRED triggers once on incremental call
    fake.conns.get(`${TEST_USER_A.principalId}:feishu_calendar`)!.sync_cursor = 'stale-cursor-0';

    const recovered = await service.syncConnection(TEST_USER_A, {
      provider: 'feishu_calendar',
      windowStart: '2026-11-12T00:00:00.000Z',
      windowEnd: '2026-11-14T00:00:00.000Z',
      forceFullSync: false,
      allowLive: false,
    });
    expect(recovered.recoveredFromExpiredCursor).toBe(true);
    expect(recovered.nextCursor).toBe('mock-cursor:feishu_calendar:1');

    failMode = 'token_revoked';
    await expect(
      service.syncConnection(TEST_USER_A, {
        provider: 'feishu_calendar',
        forceFullSync: false,
        allowLive: false,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fake.conns.get(`${TEST_USER_A.principalId}:feishu_calendar`)?.status).toBe(
      'reauth_required',
    );

    await expect(
      service.beginAuthorize(TEST_USER_A, {
        provider: 'google_calendar',
        allowLive: true,
      }),
    ).rejects.toBeInstanceOf(ApiCodeException);
  });
});
