import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

describe('events API client (M6-05)', () => {
  it('sends coordination request with CSRF for web and Bearer cookie-free for mobile', async () => {
    const mockResponse = {
      status: 'candidates_ready',
      provider: 'mock',
      model: 'mock-deterministic-v1',
      mock: true,
      extractedConstraints: {
        title: '组会讨论',
        durationMinutes: 60,
        windowStart: '2026-11-13T00:00:00.000Z',
        windowEnd: '2026-11-14T00:00:00.000Z',
        timezone: 'Asia/Shanghai',
        workingHoursOnly: true,
        workingHours: { startHour: 9, endHour: 18 },
        preferredTimeOfDay: 'afternoon',
        notes: null,
      },
      missingConstraints: [],
      clarificationPrompts: [],
      candidates: [
        {
          startAt: '2026-11-13T05:00:00.000Z',
          endAt: '2026-11-13T06:00:00.000Z',
          score: 0.95,
          reason: '所有已授权参与者均空闲',
        },
      ],
      externalCalendarsModified: false,
    };

    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(mockResponse, { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetcher });

    const webRes = await client.events.coordinate(
      {
        prompt: '明天下午开一小时组会',
        participantIds: [USER_A, USER_B],
        defaultTimezone: 'Asia/Shanghai',
        maxCandidates: 5,
      },
      { auth: { kind: 'web', csrfToken: 'csrf-token-1' } },
    );
    expect(webRes.status).toBe('candidates_ready');
    const [, webInit] = fetcher.mock.calls[0]!;
    expect(webInit?.credentials).toBe('include');
    expect((webInit?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-token-1');

    await client.events.coordinate(
      {
        prompt: '明天下午开一小时组会',
        participantIds: [USER_A, USER_B],
        defaultTimezone: 'Asia/Shanghai',
        maxCandidates: 5,
      },
      { auth: { kind: 'mobile', bearerToken: 'mobile-token-1' } },
    );
    const [, mobileInit] = fetcher.mock.calls[1]!;
    expect(mobileInit?.credentials).toBe('omit');
    expect((mobileInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer mobile-token-1',
    );
  });

  it('rejects missing CSRF, invalid requests, and malformed responses without auto-retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          status: 'candidates_ready',
          externalCalendarsModified: true,
        },
        { status: 200 },
      ),
    );
    const client = createApiClient({ fetcher });

    await expect(
      client.events.coordinate(
        {
          prompt: '   ',
          participantIds: [USER_A],
          defaultTimezone: 'Asia/Shanghai',
          maxCandidates: 5,
        },
        { auth: { kind: 'web', csrfToken: 'csrf-1' } },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await expect(
      client.events.coordinate(
        {
          prompt: '明天下午开会',
          participantIds: [USER_A],
          defaultTimezone: 'Asia/Shanghai',
          maxCandidates: 5,
        },
        { auth: { kind: 'web' } },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      client.events.coordinate(
        {
          prompt: '明天下午开会',
          participantIds: [USER_A],
          defaultTimezone: 'Asia/Shanghai',
          maxCandidates: 5,
        },
        { auth: { kind: 'web', csrfToken: 'csrf-1' } },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
