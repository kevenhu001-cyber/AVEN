import { describe, expect, it, vi } from 'vitest';
import { createReferralsClient } from './referrals';

describe('ReferralsClient', () => {
  it('submits a supplement with valid payload', async () => {
    const request = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      referralId: '22222222-2222-4222-8222-222222222222',
      supplementVersion: 1,
      authorUserId: '33333333-3333-4333-8333-333333333333',
      content:
        'Here is my GitHub repository and academic publication link: https://github.com/example/project',
      createdAt: '2026-11-12T10:00:00.000Z',
    });
    const client = createReferralsClient(request, () => new Error('BAD_REQUEST'));

    const res = await client.submitSupplement('22222222-2222-4222-8222-222222222222', {
      content:
        'Here is my GitHub repository and academic publication link: https://github.com/example/project',
      expectedVersion: 1,
    });

    expect(request).toHaveBeenCalledWith(
      '/api/v1/referrals/22222222-2222-4222-8222-222222222222/supplements',
      expect.any(Function),
      expect.objectContaining({
        method: 'POST',
        body: {
          content:
            'Here is my GitHub repository and academic publication link: https://github.com/example/project',
          expectedVersion: 1,
        },
      }),
    );
    expect(res.supplementVersion).toBe(1);
  });

  it('lists supplements for a referral', async () => {
    const request = vi.fn().mockResolvedValue({
      referralId: '22222222-2222-4222-8222-222222222222',
      supplements: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          referralId: '22222222-2222-4222-8222-222222222222',
          supplementVersion: 1,
          authorUserId: '33333333-3333-4333-8333-333333333333',
          content:
            'Here is my GitHub repository and academic publication link: https://github.com/example/project',
          createdAt: '2026-11-12T10:00:00.000Z',
        },
      ],
    });
    const client = createReferralsClient(request, () => new Error('BAD_REQUEST'));

    const res = await client.listSupplements('22222222-2222-4222-8222-222222222222');
    expect(request).toHaveBeenCalledWith(
      '/api/v1/referrals/22222222-2222-4222-8222-222222222222/supplements',
      expect.any(Function),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(res.supplements).toHaveLength(1);
  });

  it('rejects invalid supplement content client-side', async () => {
    const request = vi.fn();
    const badRequest = vi.fn(() => new Error('INVALID_REQUEST'));
    const client = createReferralsClient(request, badRequest);

    await expect(
      client.submitSupplement('b0000000-0000-0000-0000-000000000002', {
        content: '',
      }),
    ).rejects.toThrow('INVALID_REQUEST');

    expect(request).not.toHaveBeenCalled();
  });
});
