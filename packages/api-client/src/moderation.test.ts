import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index.js';

describe('Moderation API Client', () => {
  it('calls POST /api/v1/blocks and parses response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        ownerUserId: '22222222-2222-4222-8222-222222222222',
        blockedUserId: '33333333-3333-4333-8333-333333333333',
        reason: 'spam',
        createdAt: '2026-11-12T13:00:00.000Z',
      }),
    });

    const client = createApiClient({ baseUrl: 'http://localhost:3000', fetcher: mockFetch });
    const res = await client.moderation.blockUser(
      {
        blockedUserId: '33333333-3333-4333-8333-333333333333',
        reason: 'spam',
      },
      { csrfToken: 'csrf-123' },
    );

    expect(res.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/blocks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-123' }),
      }),
    );
  });

  it('calls DELETE /api/v1/blocks/:userId and parses response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        unblocked: true,
      }),
    });

    const client = createApiClient({ baseUrl: 'http://localhost:3000', fetcher: mockFetch });
    const res = await client.moderation.unblockUser('33333333-3333-4333-8333-333333333333', {
      bearerToken: 'token-abc',
    });

    expect(res.unblocked).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/blocks/33333333-3333-4333-8333-333333333333',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      }),
    );
  });

  it('calls GET /api/v1/blocks and parses response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        blocks: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            blockedUserId: '33333333-3333-4333-8333-333333333333',
            reason: null,
            createdAt: '2026-11-12T13:00:00.000Z',
          },
        ],
      }),
    });

    const client = createApiClient({ baseUrl: 'http://localhost:3000', fetcher: mockFetch });
    const res = await client.moderation.listBlocks();

    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]?.blockedUserId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('calls POST /api/v1/reports and parses response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '99999999-9999-4999-8999-999999999999',
        reporterUserId: '22222222-2222-4222-8222-222222222222',
        targetType: 'user',
        targetId: '33333333-3333-4333-8333-333333333333',
        reason: 'harassment',
        details: 'Offensive messages',
        status: 'open',
        createdAt: '2026-11-12T13:00:00.000Z',
      }),
    });

    const client = createApiClient({ baseUrl: 'http://localhost:3000', fetcher: mockFetch });
    const res = await client.moderation.submitReport({
      targetType: 'user',
      targetId: '33333333-3333-4333-8333-333333333333',
      reason: 'harassment',
      details: 'Offensive messages',
    });

    expect(res.status).toBe('open');
  });

  it('calls GET /api/v1/reports and parses response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reports: [],
      }),
    });

    const client = createApiClient({ baseUrl: 'http://localhost:3000', fetcher: mockFetch });
    const res = await client.moderation.listReports();

    expect(res.reports).toEqual([]);
  });
});
