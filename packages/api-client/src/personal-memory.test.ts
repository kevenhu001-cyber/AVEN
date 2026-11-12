import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';
import type { ConnectionCallOptions } from './index';

const id = 'b434644d-d195-4978-b457-765c6d9b755e';
const sourceId = '2f9c2e2a-4f77-4a0e-9d2a-9f6b2c1d3e44';
const at = '2026-11-12T10:00:00Z';
const policy = {
  displayAudience: 'owner',
  discoverable: false,
  allowedUses: [],
  campusId: null,
  version: 1,
};
const item = {
  id,
  kind: 'interest',
  title: '机器人',
  content: '机器人',
  structuredValue: null,
  sensitivity: 'normal',
  status: 'pending_confirmation',
  version: 1,
  validFrom: null,
  validUntil: null,
  confirmedAt: null,
  createdAt: at,
  updatedAt: at,
  policy,
  sourceCount: 1,
};
const detail = { ...item, sources: [] };
const candidate = {
  ...item,
  source: {
    id: sourceId,
    sourceType: 'conversation',
    sourceId: null,
    sourceVersion: 'mock_rules_v1',
    excerpt: '兴趣：机器人',
    createdAt: at,
  },
};
const web: ConnectionCallOptions = { auth: { kind: 'web', csrfToken: 'csrf-value' } };
const mobile: ConnectionCallOptions = { auth: { kind: 'mobile', bearerToken: 'session-value' } };

function setup(body: unknown = candidate, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      status === 204 ? new Response(null, { status }) : Response.json(body, { status }),
    );
  return { fetcher, client: createApiClient({ fetcher }).memories };
}

describe('personal memory review client', () => {
  it('reads pending candidates without a write token', async () => {
    const { client, fetcher } = setup({ data: [candidate], nextCursor: null });
    const result = await client.candidates({ auth: { kind: 'web' } });
    expect(result.data[0]?.source?.sourceType).toBe('conversation');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/memories/candidates?limit=50');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('extracts candidates from text and labels the mock extractor', async () => {
    const { client, fetcher } = setup({ extractor: 'mock_rules_v1', data: [candidate] });
    const result = await client.extract({ text: '兴趣：机器人', sourceType: 'conversation' }, web);
    expect(result.extractor).toBe('mock_rules_v1');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/memories/extract');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'X-CSRF-Token': 'csrf-value', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '兴趣：机器人', sourceType: 'conversation' }),
    });
  });

  it('rejects invalid extraction input before sending anything', async () => {
    const { client, fetcher } = setup();
    await expect(client.extract({ text: '   ' }, web)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('confirms a candidate with the expected version and explicit uses', async () => {
    const { client, fetcher } = setup(detail);
    await client.confirm(id, { expectedVersion: 1, allowedUses: ['self_ai'] }, web);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/memories/${id}/confirm`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ expectedVersion: 1, allowedUses: ['self_ai'] }),
    });
  });

  it('rejects a candidate with the expected version', async () => {
    const { client, fetcher } = setup(detail);
    await client.reject(id, 2, web);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/memories/${id}/reject`);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ expectedVersion: 2 }));
  });

  it('updates a confirmed memory with PATCH and the current version', async () => {
    const { client, fetcher } = setup(detail);
    await client.update(id, { expectedVersion: 3, title: '新标题' }, web);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/memories/${id}`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: { 'X-CSRF-Token': 'csrf-value' },
      body: JSON.stringify({ expectedVersion: 3, title: '新标题' }),
    });
  });

  it('removes a memory with the expected version in the query string', async () => {
    const { client, fetcher } = setup(undefined, 204);
    await client.remove(id, 4, web);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/memories/${id}?expectedVersion=4`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { 'X-CSRF-Token': 'csrf-value' },
    });
  });

  it('blocks unsafe identifiers and stale versions before sending a request', async () => {
    const { client, fetcher } = setup();
    await expect(client.confirm('../other', { expectedVersion: 1 }, web)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(client.update(id, { expectedVersion: 0 }, web)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(client.remove(id, 0, web)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses mobile bearer credentials for memory writes', async () => {
    const { client, fetcher } = setup(detail);
    await client.confirm(id, { expectedVersion: 1 }, mobile);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { Authorization: 'Bearer session-value' },
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('X-CSRF-Token');
  });
});
