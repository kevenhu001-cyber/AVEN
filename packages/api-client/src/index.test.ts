import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';

const health = {
  status: 'ok',
  service: 'api',
  stage: 'foundation',
  request_id: 'b434644d-d195-4978-b457-765c6d9b755e',
};
describe('API transport', () => {
  it('validates output and uses the same-origin health path without caching', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(health));
    expect(await createApiClient({ fetcher }).getLiveness()).toEqual(health);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/health/live');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
  });
  it('rejects success-shaped but invalid data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...health, token: 'must-not-be-forwarded' }));
    await expect(createApiClient({ fetcher }).getLiveness()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('does not expose upstream error text', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ private: 'secret' }, { status: 503 }));
    await expect(createApiClient({ fetcher }).getLiveness()).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503,
      message: 'HTTP_ERROR',
    });
  });
  it('distinguishes a network failure', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('private network details'));
    await expect(createApiClient({ fetcher }).getLiveness()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
  it('does not dispatch an already cancelled request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const signal = AbortSignal.abort();
    await expect(createApiClient({ fetcher }).getLiveness(signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts timed-out HTTP work', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    await expect(createApiClient({ fetcher, timeoutMs: 10 }).getLiveness()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
  it('rejects credential-bearing endpoints before fetching', () => {
    expect(() => createApiClient({ baseUrl: 'https://user:password@example.org' })).toThrow();
  });
});
