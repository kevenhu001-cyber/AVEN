import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@aven/contracts';
import type { MobileApi } from './api';
import { SessionProvider, useSession, type Session } from './session';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  change: null as ((state: string) => void) | null,
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.change = listener;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.get,
  setItemAsync: mocks.set,
  deleteItemAsync: mocks.remove,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));
vi.mock('expo-crypto', () => ({
  digestStringAsync: async () => 'origin-hash',
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
}));
vi.mock('./api', () => ({
  mobileCall: (bearerToken: string, signal?: AbortSignal) => ({
    auth: { kind: 'mobile', bearerToken },
    signal,
  }),
  expired: (error: unknown) => error instanceof Error && error.message === '401',
  problemText: () => 'request failed',
}));
vi.mock('./ui', () => ({
  Page: ({ children }: { children: React.ReactNode }) => children,
  Copy: ({ children }: { children: React.ReactNode }) => children,
  Problem: ({ message }: { message: string }) => message,
  Action: () => null,
  Loading: () => null,
  Mascot: () => null,
}));
const at = '2026-11-13T00:00:00Z';
const me: MeResponse = {
  user: {
    id: 'b434644d-d195-4978-b457-765c6d9b755e',
    displayName: 'private-user',
    email: 'test@example.test',
    emailVerified: true,
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
  },
  session: {
    id: 'b434644d-d195-4978-b457-765c6d9b755e',
    client: 'mobile',
    userAgent: null,
    createdAt: at,
    lastSeenAt: at,
    expiresAt: at,
    revokedAt: null,
    current: true,
  },
};
let renderer: ReactTestRenderer;
let current: Session;
let detached = 0;
function PrivateView() {
  current = useSession();
  useEffect(
    () => () => {
      detached++;
    },
    [],
  );
  return current.me.user.displayName;
}
function AnonymousView() {
  return null;
}
function mount(read: ReturnType<typeof vi.fn>) {
  const api = { auth: { me: read } } as unknown as MobileApi;
  renderer = create(
    createElement(
      SessionProvider,
      { api, origin: 'https://api.example.test', renderAuth: () => createElement(AnonymousView) },
      createElement(PrivateView),
    ),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.storage.clear();
  mocks.storage.set('aven.session.origin-hash', 'device-token');
  mocks.get.mockImplementation(async (key) => mocks.storage.get(key) ?? null);
  mocks.set.mockImplementation(async (key, value) => {
    mocks.storage.set(key, value);
  });
  mocks.remove.mockImplementation(async (key) => {
    mocks.storage.delete(key);
  });
  detached = 0;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.clearAllMocks();
});
describe('mobile private session lifecycle', () => {
  it('loads credentials from origin-bound secure storage and validates Bearer', async () => {
    const read = vi.fn().mockResolvedValue(me);
    await act(async () => mount(read));
    expect(mocks.get).toHaveBeenCalledWith('aven.session.origin-hash');
    expect(read.mock.calls[0]?.[1]).toMatchObject({
      auth: { kind: 'mobile', bearerToken: 'device-token' },
    });
    expect(renderer.root.findByType(PrivateView).children).toEqual(['private-user']);
  });
  it('unmounts private views in background and waits for server on resume', async () => {
    const wait = deferred<MeResponse>();
    const read = vi.fn().mockResolvedValueOnce(me).mockReturnValueOnce(wait.promise);
    await act(async () => mount(read));
    await act(async () => mocks.change?.('background'));
    expect(detached).toBe(1);
    expect(renderer.root.findAllByType(PrivateView)).toHaveLength(0);
    await act(async () => mocks.change?.('active'));
    expect(renderer.root.findAllByType(PrivateView)).toHaveLength(0);
    await act(async () => wait.resolve(me));
    expect(renderer.root.findAllByType(PrivateView)).toHaveLength(1);
  });
  it('does not restore a stale validation after invalidation', async () => {
    const wait = deferred<MeResponse>();
    const read = vi.fn().mockResolvedValueOnce(me).mockReturnValueOnce(wait.promise);
    await act(async () => mount(read));
    const invalidate = current.invalidate;
    await act(async () => mocks.change?.('background'));
    await act(async () => mocks.change?.('active'));
    await act(async () => invalidate());
    await act(async () => wait.resolve(me));
    expect(renderer.root.findAllByType(PrivateView)).toHaveLength(0);
    expect(renderer.root.findAllByType(AnonymousView)).toHaveLength(1);
    expect(mocks.storage.size).toBe(0);
  });
  it('clears device token on server 401', async () => {
    const read = vi.fn().mockRejectedValue(new Error('401'));
    await act(async () => mount(read));
    expect(renderer.root.findAllByType(AnonymousView)).toHaveLength(1);
    expect(mocks.storage.size).toBe(0);
  });
  it('hides private views on network failure without silently deleting credentials', async () => {
    const read = vi.fn().mockResolvedValueOnce(me).mockRejectedValueOnce(new Error('network'));
    await act(async () => mount(read));
    await act(async () => current.refresh());
    expect(renderer.root.findAllByType(PrivateView)).toHaveLength(0);
    expect(mocks.storage.get('aven.session.origin-hash')).toBe('device-token');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
