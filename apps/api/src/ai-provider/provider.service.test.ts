import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../auth/auth.types';
import { UserAIProviderService } from './provider.service';
const mocks = vi.hoisted(() => ({ stream: vi.fn(), options: vi.fn(), rate: vi.fn() }));
vi.mock('../auth/rate-limit.js', () => ({
  AuthRateLimiter: class {
    consume() {
      return mocks.rate();
    }
    close() {}
  },
}));
vi.mock('@aven/ai-core', async () => ({
  ...(await vi.importActual('@aven/ai-core')),
  OpenAICompatibleProvider: class {
    constructor(options: unknown) {
      mocks.options(options);
    }
    streamText(input: unknown) {
      return mocks.stream(input);
    }
  },
}));
const actor = {
  userId: '7334898a-e664-4b76-8499-d96d1ccc3746',
  principalId: '7334898a-e664-4b76-8499-d96d1ccc3746',
} as AuthContext;
const input = {
  baseUrl: 'https://api.channel.org/v1',
  model: 'user-model',
  apiKey: 'synthetic-user-secret',
  expectedVersion: 0,
  expectedConfigId: null,
};
beforeEach(() => {
  vi.stubEnv('AI_USER_ALLOWED_BASE_URLS', 'public_https');
  vi.clearAllMocks();
  mocks.rate.mockResolvedValue({ allowed: true, retryAfter: 0 });
});
afterEach(() => vi.unstubAllEnvs());
describe('personal connection probe', () => {
  it('sends only a fixed probe and requires a completed nonempty answer', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'OK' };
      yield { type: 'done' };
    });
    const service = new UserAIProviderService();
    expect(await service.test(actor, input)).toEqual({ ok: true });
    expect(mocks.stream.mock.calls[0]?.[0].messages).toEqual([
      { role: 'user', content: 'Reply with OK.' },
    ]);
    expect(mocks.options.mock.calls[0]?.[0].model).toBe('user-model');
    await service.onModuleDestroy();
  });
  it('reports a safe provider code without returning upstream text or the key', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: 'error',
        error: { code: 'PROVIDER_RATE_LIMITED', message: 'untrusted ' + input.apiKey },
      };
    });
    const service = new UserAIProviderService();
    const result = await service.test(actor, input);
    expect(result).toEqual({ ok: false, errorCode: 'PROVIDER_RATE_LIMITED' });
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
    await service.onModuleDestroy();
  });
  it('limits connection probes before sending to the channel', async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: false, retryAfter: 30 });
    const service = new UserAIProviderService();
    await expect(service.test(actor, input)).rejects.toMatchObject({ retryAfter: 30 });
    expect(mocks.stream).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });
  it('does not interpret partial output without completion as a successful test', async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'partial' };
    });
    const service = new UserAIProviderService();
    expect(await service.test(actor, input)).toEqual({
      ok: false,
      errorCode: 'PROVIDER_INVALID_OUTPUT',
    });
    await service.onModuleDestroy();
  });
});
