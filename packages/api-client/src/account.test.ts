import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';
const id = 'b434644d-d195-4978-b457-765c6d9b755e';
const at = '2026-11-13T10:00:00Z';
const user = {
  id,
  displayName: '测试',
  email: 'test@example.test',
  emailVerified: true,
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
};
const session = {
  id,
  client: 'mobile',
  userAgent: null,
  createdAt: at,
  lastSeenAt: at,
  expiresAt: at,
  revokedAt: null,
  current: true,
};
const mobile = { auth: { kind: 'mobile' as const, bearerToken: 'valid-token' } };
const web = { auth: { kind: 'web' as const, csrfToken: 'csrf-token' } };
function setup(body: unknown, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      status === 204 ? new Response(null, { status }) : Response.json(body, { status }),
    );
  return { fetcher, api: createApiClient({ fetcher }) };
}
describe('cross-platform accounts', () => {
  it('mobile login omits cookies and requires a mobile bearer response', async () => {
    const { api, fetcher } = setup({ user, session, sessionToken: 'valid-token' });
    expect(
      (await api.auth.loginMobile({ email: user.email, password: 'password' })).sessionToken,
    ).toBe('valid-token');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      body: JSON.stringify({ email: user.email, password: 'password', client: 'mobile' }),
    });
  });
  it.each([
    { user, session },
    { user, session: { ...session, client: 'web' }, sessionToken: 'valid-token' },
    { user, session, sessionToken: 'invalid token' },
    { user, session, sessionToken: 'valid-token', csrfToken: 'csrf' },
  ])('rejects invalid or mixed mobile credentials', async (body) => {
    const { api } = setup(body);
    await expect(
      api.auth.loginMobile({ email: user.email, password: 'password' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('mobile me uses bearer only', async () => {
    const { api, fetcher } = setup({ user, session });
    await api.auth.me(undefined, mobile);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('X-CSRF-Token');
  });
  it('profile writes validate timezone before network and use web CSRF', async () => {
    const { api, fetcher } = setup({ user, session });
    expect(() => api.auth.updateProfile({ timezone: 'invalid/timezone' }, web)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await api.auth.updateProfile({ timezone: 'Asia/Shanghai' }, web);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: { 'X-CSRF-Token': 'csrf-token' },
    });
  });
  it('session revocation rejects missing CSRF and invalid IDs before sending', async () => {
    const { api, fetcher } = setup(undefined, 204);
    expect(() => api.auth.revokeSession(id, { auth: { kind: 'web' } })).toThrow();
    expect(() => api.auth.revokeSession('../other', mobile)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await api.auth.revokeSession(id, mobile);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/auth/sessions/${id}/revoke`);
  });
  it('password changes are not automatically retried on unknown result', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'));
    const api = createApiClient({ fetcher });
    await expect(
      api.auth.changePassword(
        { currentPassword: 'old-password', newPassword: 'new-password-long' },
        mobile,
      ),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('history uses paired cursors, bearer and rejects leaked body fields', async () => {
    const { api, fetcher } = setup({
      data: [
        {
          id,
          conversationId: id,
          status: 'completed',
          provider: 'mock',
          model: 'mock',
          createdAt: at,
        },
      ],
      nextCursor: null,
    });
    expect(() => api.agent.history({ cursorId: id }, mobile)).toThrow();
    await api.agent.history({ cursorId: id, cursorCreatedAt: at }, mobile);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { Authorization: 'Bearer valid-token' },
    });
    fetcher.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            id,
            conversationId: id,
            status: 'completed',
            provider: 'mock',
            model: 'mock',
            createdAt: at,
            input: 'private',
          },
        ],
        nextCursor: null,
      }),
    );
    await expect(api.agent.history({}, mobile)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
