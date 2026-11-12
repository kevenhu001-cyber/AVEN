import { describe, expect, it } from 'vitest';
import {
  CalendarConnectAuthorizeRequestSchema,
  CalendarConnectCallbackRequestSchema,
  CalendarConnectionSummarySchema,
  CalendarOAuthProviderSchema,
  CalendarRevokeResponseSchema,
  CalendarSyncRequestSchema,
  CalendarSyncResultSchema,
} from './index.js';

describe('calendar OAuth connection contracts', () => {
  it('validates supported providers and strict authorize/callback inputs', () => {
    expect(CalendarOAuthProviderSchema.safeParse('google_calendar').success).toBe(true);
    expect(CalendarOAuthProviderSchema.safeParse('feishu_calendar').success).toBe(true);
    expect(CalendarOAuthProviderSchema.safeParse('unknown_cal').success).toBe(false);

    const authReq = CalendarConnectAuthorizeRequestSchema.parse({
      provider: 'google_calendar',
      redirectUri: 'https://app.aven.example.com/calendar/callback',
    });
    expect(authReq.allowLive).toBe(false);

    expect(
      CalendarConnectAuthorizeRequestSchema.safeParse({
        provider: 'google_calendar',
        redirectUri: 'https://127.0.0.1/callback',
      }).success,
    ).toBe(false);

    expect(
      CalendarConnectCallbackRequestSchema.safeParse({
        provider: 'google_calendar',
        code: 'abc',
        stateToken: 'x'.repeat(24),
      }).success,
    ).toBe(false);
  });

  it('validates sync window ordering and rejects unexpected token fields in summary', () => {
    expect(
      CalendarSyncRequestSchema.safeParse({
        provider: 'microsoft_outlook',
        windowStart: '2026-11-15T10:00:00.000Z',
        windowEnd: '2026-11-14T10:00:00.000Z',
      }).success,
    ).toBe(false);

    expect(
      CalendarConnectionSummarySchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        provider: 'google_calendar',
        status: 'active',
        keyVersion: 1,
        syncCursor: 'cursor-1',
        lastSyncedAt: '2026-11-12T10:00:00.000Z',
        createdAt: '2026-11-12T09:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
        credentialsCiphertext: 'should-not-pass-strict',
      }).success,
    ).toBe(false);

    const syncRes = CalendarSyncResultSchema.parse({
      provider: 'google_calendar',
      status: 'active',
      providerMode: 'mock',
      importedBlocksCount: 2,
      deletedBlocksCount: 1,
      previousCursor: null,
      nextCursor: 'cursor-2',
      recoveredFromExpiredCursor: false,
      lastSyncedAt: '2026-11-12T10:00:00.000Z',
      privacyNotice: '仅同步忙闲时间段，不保存外部日程标题与参与者详情。',
    });
    expect(syncRes.importedBlocksCount).toBe(2);

    const revokeRes = CalendarRevokeResponseSchema.parse({
      provider: 'google_calendar',
      revoked: true,
      deletedSyncedBlocksCount: 2,
    });
    expect(revokeRes.revoked).toBe(true);
  });
});
