import { describe, expect, it } from 'vitest';
import { createApiClient, ApiClientError } from './index';

describe('calendar connections api client', () => {
  it('validates requests, sends per-call CSRF/bearer auth, and parses responses', async () => {
    const seenUrls: string[] = [];
    const seenHeaders: Array<Record<string, string>> = [];

    const client = createApiClient({
      baseUrl: 'https://api.aven.example.com',
      fetcher: async (input, init) => {
        const url = String(input);
        seenUrls.push(url);
        seenHeaders.push((init?.headers ?? {}) as Record<string, string>);

        if (url.endsWith('/authorize')) {
          return new Response(
            JSON.stringify({
              provider: 'google_calendar',
              authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
              stateToken: 's'.repeat(24),
              expiresAt: '2026-11-12T12:00:00.000Z',
              scopes: ['https://www.googleapis.com/auth/calendar.freebusy'],
              providerMode: 'mock',
            }),
            { status: 200 },
          );
        }

        if (url.endsWith('/sync')) {
          return new Response(
            JSON.stringify({
              provider: 'google_calendar',
              status: 'active',
              providerMode: 'mock',
              importedBlocksCount: 2,
              deletedBlocksCount: 0,
              previousCursor: null,
              nextCursor: 'mock-cursor:google_calendar:1',
              recoveredFromExpiredCursor: false,
              lastSyncedAt: '2026-11-12T10:00:00.000Z',
              privacyNotice: '仅同步忙闲时间段。',
            }),
            { status: 200 },
          );
        }

        if (url.endsWith('/revoke')) {
          return new Response(
            JSON.stringify({
              provider: 'google_calendar',
              revoked: true,
              deletedSyncedBlocksCount: 2,
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ connections: [] }), { status: 200 });
      },
    });

    const authWeb = { kind: 'web' as const, csrfToken: 'csrf-123' };
    const authRes = await client.calendarConnections.authorize(
      { provider: 'google_calendar' },
      { auth: authWeb },
    );
    expect(authRes.providerMode).toBe('mock');
    expect(seenHeaders[0]?.['X-CSRF-Token']).toBe('csrf-123');

    const syncRes = await client.calendarConnections.sync(
      { provider: 'google_calendar' },
      { auth: { kind: 'mobile', bearerToken: 'mob-tok' } },
    );
    expect(syncRes.nextCursor).toBe('mock-cursor:google_calendar:1');
    expect(seenHeaders[1]?.Authorization).toBe('Bearer mob-tok');

    const revokeRes = await client.calendarConnections.revoke('google_calendar', {
      auth: authWeb,
    });
    expect(revokeRes.deletedSyncedBlocksCount).toBe(2);

    await expect(
      client.calendarConnections.authorize(
        {
          provider: 'google_calendar',
          redirectUri: 'https://127.0.0.1/bad',
        },
        { auth: authWeb },
      ),
    ).rejects.toBeInstanceOf(ApiClientError);

    expect(seenUrls).toHaveLength(3);
  });
});
