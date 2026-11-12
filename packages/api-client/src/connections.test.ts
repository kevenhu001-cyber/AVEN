import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';
import type { ConnectionCallOptions } from './index';

const id = 'b434644d-d195-4978-b457-765c6d9b755e';
const other = 'e0f6c512-deca-4823-b409-b7f49aad1f68';
const at = '2026-11-12T10:00:00+00:00';
const invitation = {
  id,
  senderUserId: id,
  recipientUserId: other,
  status: 'pending',
  version: 1,
  grantId: id,
  grantStatus: 'active',
  senderConfirmedAt: at,
  recipientDecidedAt: null,
  expiresAt: at,
  createdAt: at,
  connectionId: null,
};
const web: ConnectionCallOptions = { auth: { kind: 'web', csrfToken: 'csrf-value' } };
const mobile: ConnectionCallOptions = { auth: { kind: 'mobile', bearerToken: 'session-value' } };
function setup(body: unknown = invitation, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(body, { status }));
  return { fetcher, client: createApiClient({ fetcher }).connections };
}

describe('personal connection client', () => {
  it('validates preview input and applies the shared default without sending identity fields', async () => {
    const { client, fetcher } = setup({
      id,
      recipientUserId: other,
      purpose: 'connection_invitation',
      snapshot: [],
      grantExpiresAt: at,
      expiresAt: at,
    });
    await client.preview({ recipientUserId: other, memoryItemIds: [id] }, web);
    const init = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      recipientUserId: other,
      memoryItemIds: [id],
      expiresInDays: 7,
    });
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'X-CSRF-Token': 'csrf-value', 'Content-Type': 'application/json' },
    });
  });
  it('requires explicit idempotency keys and preserves them across explicit retries', async () => {
    const { client, fetcher } = setup();
    await client.send(id, other, web);
    await client.send(id, other, web);
    expect(
      fetcher.mock.calls.every(
        (call) => (call[1]?.headers as Record<string, string>)['Idempotency-Key'] === other,
      ),
    ).toBe(true);
    await expect(client.send(id, 'invalid', web)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('uses mobile bearer credentials without browser cookies', async () => {
    const { client, fetcher } = setup();
    await client.decide(id, { decision: 'accepted', expectedVersion: 1 }, mobile);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { Authorization: 'Bearer session-value' },
      body: JSON.stringify({ decision: 'accepted', expectedVersion: 1 }),
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('X-CSRF-Token');
  });
  it('does not retain credentials between callers', async () => {
    const { client, fetcher } = setup();
    await client.getInvitation(id, mobile);
    await client.getInvitation(id, { auth: { kind: 'web' } });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include' });
    expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty('Authorization');
  });
  it('rejects missing CSRF, unsafe tokens, bad versions and path injection before fetching', async () => {
    const { client, fetcher } = setup();
    await expect(client.revoke(id, { auth: { kind: 'web' } })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(
      client.revoke(id, { auth: { kind: 'mobile', bearerToken: 'token\r\nsecret' } }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.withdraw(id, 0, web)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.getInvitation('../auth', web)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps malformed response contents out of errors', async () => {
    const { client } = setup({ ...invitation, privateBody: 'private text' });
    await expect(client.getInvitation(id, web)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'INVALID_RESPONSE',
    });
  });
  it('rejects a widget referencing a different invitation', async () => {
    const { client } = setup({
      kind: 'connection_invitation',
      role: 'recipient',
      invitation,
      snapshot: { invitationId: other, items: [] },
    });
    await expect(client.getWidget(id, web)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('reads widgets afresh after revocation without reusing private content', async () => {
    const first = {
      kind: 'connection_invitation',
      role: 'recipient',
      invitation,
      snapshot: {
        invitationId: id,
        items: [{ sourceId: id, field: 'content', value: 'selected' }],
      },
    };
    const { client, fetcher } = setup();
    fetcher.mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(
      Response.json({
        ...first,
        invitation: { ...invitation, grantStatus: 'revoked' },
        snapshot: { invitationId: id, items: [] },
      }),
    );
    expect((await client.getWidget(id, web)).snapshot.items).toHaveLength(1);
    expect((await client.getWidget(id, web)).snapshot.items).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('never retries a failed mutation automatically', async () => {
    const { client, fetcher } = setup();
    fetcher.mockRejectedValue(new Error('private network detail'));
    await expect(client.send(id, other, web)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not deliver a late response after the caller cancels', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      return Response.json(invitation);
    });
    await expect(
      createApiClient({ fetcher }).connections.getInvitation(id, {
        ...web,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('preserves conflict request IDs without exposing private upstream messages', async () => {
    const { client } = setup(
      { error: { code: 'CONFLICT', request_id: id, message: 'private detail', retryable: false } },
      409,
    );
    await expect(
      client.decide(id, { decision: 'accepted', expectedVersion: 1 }, web),
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 409,
      requestId: id,
      message: 'HTTP_ERROR',
    });
  });
  it('cancels work before sending and during an in-flight widget read', async () => {
    const { client, fetcher } = setup();
    await expect(
      client.getWidget(id, { ...web, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();
    const read = client.getWidget(id, { ...web, signal: controller.signal });
    controller.abort();
    await expect(read).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  describe('peer messaging client', () => {
    const message = {
      id,
      connectionId: id,
      senderUserId: other,
      content: 'Hello friend',
      clientMessageId: id,
      createdAt: at,
    };

    it('sends a message with CSRF header and trimmed content', async () => {
      const { client, fetcher } = setup(message, 201);
      const res = await client.sendMessage(
        id,
        { content: '  Hello friend  ', clientMessageId: id },
        web,
      );
      expect(res).toEqual(message);
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(url).toBe(`/api/v1/connections/${id}/messages`);
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-value');
      expect(JSON.parse(String(init?.body))).toEqual({
        content: 'Hello friend',
        clientMessageId: id,
      });
    });

    it('lists messages with pagination query parameters', async () => {
      const listResponse = {
        connectionId: id,
        messages: [message],
        nextCursor: { createdAt: at, id },
      };
      const { client, fetcher } = setup(listResponse, 200);
      const res = await client.listMessages(
        id,
        { limit: 10, cursorCreatedAt: at, cursorId: id },
        mobile,
      );
      expect(res).toEqual(listResponse);
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(url).toContain(`/api/v1/connections/${id}/messages?`);
      expect(url).toContain('limit=10');
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer session-value');
    });

    it('deletes a message using DELETE method and CSRF header', async () => {
      const deleteResponse = { success: true, messageId: id };
      const { client, fetcher } = setup(deleteResponse, 200);
      const res = await client.deleteMessage(id, id, web);
      expect(res).toEqual(deleteResponse);
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(url).toBe(`/api/v1/connections/${id}/messages/${id}`);
      expect(init?.method).toBe('DELETE');
      expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-value');
    });
  });
});
