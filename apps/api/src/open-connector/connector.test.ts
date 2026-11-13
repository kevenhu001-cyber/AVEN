import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { encryptProviderKey } from '../ai-provider/provider-security.js';
import type { AuthContext } from '../auth/auth.types.js';
const mocks = vi.hoisted(() => ({ oauth: vi.fn(), get: vi.fn(), query: vi.fn() }));
vi.mock('@oomol-lab/connector', () => ({
  ProjectConnector: class {
    connect = { oauth: mocks.oauth };
    getConnectionRequest = mocks.get;
  },
}));
vi.mock('@aven/database', () => ({
  createApplicationPool: () => ({ end: async () => undefined }),
  withRequestContext: (
    _pool: unknown,
    _context: unknown,
    run: (client: { query: typeof mocks.query }) => unknown,
  ) => run({ query: mocks.query }),
}));
import { OpenConnectorService } from './connector.service.js';
const auth = { userId: 'synthetic-user', principalId: 'synthetic-user' } as AuthContext;
const record = {
  id: 'request-one',
  externalUserId: auth.userId,
  service: 'gmail',
  status: 'initiated',
  authorizationUrl: 'https://auth.example.test/oauth',
  expiresAt: '2099-01-01T00:00:00.000Z',
  connectedAccountId: null,
};
beforeEach(() => {
  vi.stubEnv('AI_USER_CONFIG_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('OOMOL_PROJECT_API_KEY', 'synthetic-environment-key');
  vi.stubEnv('OPEN_CONNECTOR_AUTH_HOSTS', 'auth.example.test');
  vi.stubEnv('WEB_ORIGIN', 'https://aven.example.test');
  mocks.query.mockReset();
  mocks.oauth.mockReset();
  mocks.get.mockReset();
  const encrypted = encryptProviderKey(
    'synthetic-project-key',
    'platform:open_connector',
    process.env.AI_USER_CONFIG_KEY,
  );
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('get_open_connector_runtime'))
      return { rows: [{ base_url: 'https://connector.oomol.com/v1', encrypted_key: encrypted }] };
    if (sql.includes('SELECT request_id')) return { rows: [{ request_id: 'request-one' }] };
    return { rows: [], rowCount: 1 };
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('Open Connector ownership and redirect boundary', () => {
  it('binds the external user and callback to server facts', async () => {
    mocks.oauth.mockResolvedValue(record);
    const result = await new OpenConnectorService().connect(auth, 'gmail');
    expect(result.authorizationUrl).toBe(record.authorizationUrl);
    expect(mocks.oauth).toHaveBeenCalledWith(auth.userId, {
      service: 'gmail',
      connectionName: 'aven',
      returnUri: 'https://aven.example.test/connectors',
    });
  });
  it('rejects a gateway response belonging to someone else', async () => {
    mocks.oauth.mockResolvedValue({ ...record, externalUserId: 'other-user' });
    await expect(new OpenConnectorService().connect(auth, 'gmail')).rejects.toThrow();
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
  });
  it('rejects an unapproved authorization host before persisting', async () => {
    mocks.oauth.mockResolvedValue({
      ...record,
      authorizationUrl: 'https://evil.example.test/oauth',
    });
    await expect(new OpenConnectorService().connect(auth, 'gmail')).rejects.toThrow();
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
  });
  it('rejects a mismatched request during status refresh', async () => {
    mocks.get.mockResolvedValue({ ...record, id: 'forged-request', status: 'connected' });
    await expect(new OpenConnectorService().refresh(auth, 'gmail')).rejects.toThrow();
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE public'))).toBe(
      false,
    );
  });
  it('uses the explicit environment key when there is no saved administrator configuration', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.oauth.mockResolvedValue(record);
    await expect(new OpenConnectorService().connect(auth, 'gmail')).resolves.toHaveProperty(
      'authorizationUrl',
    );
  });
  it('does not fall back to the environment when saved configuration cannot be decrypted', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ base_url: 'https://connector.oomol.com/v1', encrypted_key: 'invalid' }],
    });
    await expect(new OpenConnectorService().connect(auth, 'gmail')).rejects.toThrow();
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('fails before creating a gateway request when redirect hosts are not configured', async () => {
    vi.stubEnv('OPEN_CONNECTOR_AUTH_HOSTS', '');
    await expect(new OpenConnectorService().connect(auth, 'gmail')).rejects.toThrow();
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('normalizes initiated gateway requests to pending', async () => {
    mocks.get.mockResolvedValue(record);
    expect(await new OpenConnectorService().refresh(auth, 'gmail')).toEqual({ status: 'pending' });
  });
});
