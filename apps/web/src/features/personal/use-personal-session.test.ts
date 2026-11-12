import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@aven/contracts';
import { usePersonalSession } from './use-personal-session';
const mocks = vi.hoisted(() => ({ me: vi.fn(), logout: vi.fn() }));
vi.mock('./api', () => ({
  api: { auth: { me: mocks.me, logout: mocks.logout } },
  authExpired: (error: unknown) => error instanceof Error && error.message === '401',
  errorText: () => 'offline',
  webCall: () => ({}),
}));
const at = '2026-11-13T00:00:00Z';
const me: MeResponse = {
  user: {
    id: 'b434644d-d195-4978-b457-765c6d9b755e',
    displayName: 'test',
    email: 'test@example.test',
    emailVerified: true,
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
  },
  session: {
    id: 'b434644d-d195-4978-b457-765c6d9b755e',
    client: 'web',
    userAgent: null,
    createdAt: at,
    lastSeenAt: at,
    expiresAt: at,
    revokedAt: null,
    current: true,
  },
};
class Visibility extends EventTarget {
  hidden = false;
}
let documentEvents: Visibility;
let windowEvents: EventTarget;
let renderer: ReactTestRenderer;
let current: ReturnType<typeof usePersonalSession>;
function Harness() {
  const value = usePersonalSession();
  useEffect(() => {
    current = value;
  }, [value]);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  documentEvents = new Visibility();
  windowEvents = new EventTarget();
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('window', windowEvents);
  mocks.me.mockReset();
  mocks.logout.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(createElement(Harness));
  });
}
describe('web session revalidation', () => {
  it('deduplicates focus/pageshow and keeps the anonymous ready state stable', async () => {
    const pending = deferred<MeResponse>();
    mocks.me.mockRejectedValueOnce(new Error('401')).mockReturnValueOnce(pending.promise);
    await mount();
    expect(current.status).toBe('ready');
    await act(async () => {
      windowEvents.dispatchEvent(new Event('focus'));
      windowEvents.dispatchEvent(new Event('pageshow'));
      windowEvents.dispatchEvent(new Event('focus'));
    });
    expect(mocks.me).toHaveBeenCalledTimes(2);
    expect(current.status).toBe('ready');
    expect(current.me).toBeNull();
    await act(async () => pending.reject(new Error('401')));
    expect(current.status).toBe('ready');
  });
  it('keeps anonymous state mounted through background and foreground checks', async () => {
    const pending = deferred<MeResponse>();
    mocks.me.mockRejectedValueOnce(new Error('401')).mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => {
      documentEvents.hidden = true;
      documentEvents.dispatchEvent(new Event('visibilitychange'));
    });
    expect(current.status).toBe('ready');
    await act(async () => {
      documentEvents.hidden = false;
      documentEvents.dispatchEvent(new Event('visibilitychange'));
    });
    expect(current.status).toBe('ready');
    await act(async () => pending.reject(new Error('401')));
  });
  it('still hides private views until foreground validation succeeds', async () => {
    const pending = deferred<MeResponse>();
    mocks.me.mockResolvedValueOnce(me).mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => {
      documentEvents.hidden = true;
      documentEvents.dispatchEvent(new Event('visibilitychange'));
    });
    expect(current.status).toBe('checking');
    await act(async () => {
      documentEvents.hidden = false;
      documentEvents.dispatchEvent(new Event('visibilitychange'));
    });
    expect(current.status).toBe('checking');
    await act(async () => pending.resolve(me));
    expect(current.status).toBe('ready');
  });
  it('pre-login stale 401 cannot override the newly validated cookie', async () => {
    const old = deferred<MeResponse>();
    mocks.me.mockReturnValueOnce(old.promise).mockResolvedValueOnce(me);
    await mount();
    await act(async () => current.signedIn());
    expect(current.me).toEqual(me);
    await act(async () => old.reject(new Error('401')));
    expect(current.me).toEqual(me);
    expect(current.status).toBe('ready');
  });
  it('a stale read after logout cannot restore private identity', async () => {
    const old = deferred<MeResponse>();
    mocks.me.mockResolvedValueOnce(me).mockReturnValueOnce(old.promise);
    mocks.logout.mockResolvedValue(undefined);
    await mount();
    await act(async () => {
      windowEvents.dispatchEvent(new Event('focus'));
    });
    await act(async () => current.logout());
    await act(async () => old.resolve(me));
    expect(current.me).toBeNull();
    expect(current.status).toBe('ready');
  });
});
