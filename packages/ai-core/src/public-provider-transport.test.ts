import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publicProviderFetch } from './public-provider-fetch.js';
const mocks = vi.hoisted(() => ({ request: vi.fn(), destroy: vi.fn() }));
vi.mock('node:https', () => ({
  request: mocks.request,
  Agent: class {
    destroy() {
      mocks.destroy();
    }
  },
}));
beforeEach(() => vi.clearAllMocks());
function respond(status: number, payload: Buffer | string) {
  mocks.request.mockImplementation(
    (_url: unknown, _options: unknown, callback: (response: unknown) => void) => {
      class Request extends EventEmitter {
        end() {
          const response = Object.assign(new PassThrough(), {
            statusCode: status,
            headers: { 'content-type': 'text/event-stream' },
          });
          callback(response);
          response.end(payload);
        }
        destroy(error?: Error) {
          if (error) this.emit('error', error);
          return this;
        }
      }
      return new Request();
    },
  );
}
const options = {
  method: 'POST',
  body: '{}',
  headers: { Authorization: 'Bearer synthetic-secret' },
};
describe('bounded personal upstream transport', () => {
  it('streams a normal response through the bounded reader', async () => {
    respond(200, 'data: [DONE]\n\n');
    const response = await publicProviderFetch(
      'https://api.channel.org/v1/chat/completions',
      options,
    );
    expect(await response.text()).toBe('data: [DONE]\n\n');
  });
  it('rejects redirects without making a follow-up request', async () => {
    respond(302, 'redirect');
    await expect(
      publicProviderFetch('https://api.channel.org/v1/chat/completions', options),
    ).rejects.toThrow();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid upstream status without an uncaught callback exception', async () => {
    respond(600, 'invalid');
    await expect(
      publicProviderFetch('https://api.channel.org/v1/chat/completions', options),
    ).rejects.toThrow();
  });
  it('stops an oversized response', async () => {
    respond(200, Buffer.alloc(1048577));
    const response = await publicProviderFetch(
      'https://api.channel.org/v1/chat/completions',
      options,
    );
    await expect(response.text()).rejects.toThrow();
    expect(mocks.destroy).toHaveBeenCalled();
  });
});
