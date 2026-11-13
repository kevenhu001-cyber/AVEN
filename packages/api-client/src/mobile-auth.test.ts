import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';
const id = 'b434644d-d195-4978-b457-765c6d9b755e';
const timestamp = '2026-11-13T00:00:00.000Z';
const user = {
  id,
  displayName: 'Synthetic',
  email: 'synthetic@example.test',
  emailVerified: true,
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
};
const session = {
  id,
  client: 'mobile',
  userAgent: null,
  createdAt: timestamp,
  lastSeenAt: timestamp,
  expiresAt: '2099-01-01T00:00:00.000Z',
  revokedAt: null,
  current: true,
};
describe('native authentication transport', () => {
  it('requests a mobile session and requires a mobile bearer token in the response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ user, session, sessionToken: 'synthetic-token' }));
    const client = createApiClient({ fetcher });
    const result = await client.auth.loginMobile({
      email: user.email,
      password: 'synthetic-password',
    });
    expect(result.sessionToken).toBe('synthetic-token');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).client).toBe('mobile');
    const invalid = createApiClient({ fetcher: async () => Response.json({ user, session }) });
    await expect(
      invalid.auth.loginMobile({ email: user.email, password: 'synthetic-password' }),
    ).rejects.toThrow();
  });
  it('verifies identity with Bearer authentication and omits cookies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user, session }));
    const client = createApiClient({ fetcher });
    await client.auth.meMobile({ auth: { kind: 'mobile', bearerToken: 'synthetic-token' } });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { Authorization: 'Bearer synthetic-token' },
    });
    expect(() => client.auth.meMobile({ auth: { kind: 'web' } })).toThrow();
  });
});
