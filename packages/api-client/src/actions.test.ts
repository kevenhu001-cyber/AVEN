import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';

const id = 'b434644d-d195-4978-b457-765c6d9b755e';
const call = { auth: { kind: 'mobile' as const, bearerToken: 'device-token' } };
const confirmation = { expectedDraftVersion: 2, confirmationToken: 'one-use-token' };
const at = '2026-11-13T10:00:00Z';
const action = {
  id,
  actionType: 'memory.create',
  status: 'succeeded',
  draftVersion: 2,
  runId: null,
  organizationId: null,
  preview: {},
  expiresAt: at,
  confirmedAt: at,
  executedAt: at,
  result: {},
  createdAt: at,
  updatedAt: at,
};
describe('action confirmation transport', () => {
  it('binds confirmation token, draft version and idempotency key to bearer-only request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(action));
    const api = createApiClient({ fetcher });
    await api.actions.confirm(id, confirmation, 'same-key', call);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/actions/${id}/confirm`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify(confirmation),
        headers: expect.objectContaining({
          Authorization: 'Bearer device-token',
          'Idempotency-Key': 'same-key',
        }),
      }),
    );
  });
  it('does not retry an unknown execution result', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'));
    const api = createApiClient({ fetcher });
    await expect(api.actions.confirm(id, confirmation, 'same-key', call)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects forged paths, empty keys and missing web CSRF before the network', () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = createApiClient({ fetcher });
    expect(() => api.actions.get('../other', call)).toThrow();
    expect(() => api.actions.confirm(id, confirmation, ' ', call)).toThrow();
    expect(() => api.actions.cancel(id, 'same-key', { auth: { kind: 'web' } })).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
