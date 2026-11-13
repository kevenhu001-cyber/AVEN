import { describe, expect, it, vi } from 'vitest';
import type { DatabasePool } from '@aven/database';
import { authorizeExternalRun } from './external-preflight';
const mocks = vi.hoisted(() => ({ context: vi.fn(), query: vi.fn() }));
vi.mock('@aven/database', () => ({ withRequestContext: mocks.context }));
const pool = {} as DatabasePool;
const identity = { runId: 'run', userId: 'user', principalId: 'user' };
describe('external data preflight', () => {
  it('binds the real run owner and reads current source authorization', async () => {
    mocks.context.mockImplementation(async (_pool, _context, work) => work({ query: mocks.query }));
    mocks.query.mockResolvedValue({
      rows: [{ sources_valid: true, history_expired: false, status: 'running' }],
    });
    expect(await authorizeExternalRun(pool, identity)).toBe(true);
    expect(mocks.context).toHaveBeenLastCalledWith(
      pool,
      { userId: 'user', principalId: 'user', requestId: 'run' },
      expect.any(Function),
    );
  });
  it.each([
    { sources_valid: false, history_expired: false, status: 'running' },
    { sources_valid: true, history_expired: true, status: 'running' },
    { sources_valid: true, history_expired: false, status: 'cancelling' },
  ])('rejects stale or inactive sources: %j', async (row) => {
    mocks.context.mockImplementation(async (_pool, _context, work) => work({ query: mocks.query }));
    mocks.query.mockResolvedValue({ rows: [row] });
    expect(await authorizeExternalRun(pool, identity)).toBe(false);
  });
  it('rejects an organization identity without querying private context', async () => {
    mocks.context.mockClear();
    expect(await authorizeExternalRun(pool, { ...identity, principalId: 'org' })).toBe(false);
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
