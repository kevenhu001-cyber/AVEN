import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';
const id = '11111111-1111-4111-8111-111111111111';
const web = { auth: { kind: 'web' as const, csrfToken: 'csrf' } };
describe('notification client', () => {
  it('validates paired cursors without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createApiClient({ fetcher }).notifications;
    await expect(client.list({ cursorId: id }, web)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(client.read('../secrets', web)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires CSRF for writes and keeps mobile calls cookie-free', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ connectionInvitations: true, connectionUpdates: true, version: 0 }),
      );
    const client = createApiClient({ fetcher }).notifications;
    await expect(client.read(id, { auth: { kind: 'web' } })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await client.getPreferences({ auth: { kind: 'mobile', bearerToken: 'token' } });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: 'Bearer token' },
    });
  });
  it('does not automatically retry a failed read mutation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private upstream detail'));
    await expect(createApiClient({ fetcher }).notifications.read(id, web)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'NETWORK_ERROR',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed inbox responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [], nextCursor: null, unreadCount: 0, privateText: 'secret' }),
      );
    await expect(createApiClient({ fetcher }).notifications.list({}, web)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
