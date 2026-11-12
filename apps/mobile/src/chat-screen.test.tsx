import { createElement, type PropsWithChildren } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatScreen } from './chat-screen';
import { Action, Field } from './ui';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  events: vi.fn(),
  cancel: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-key' }));
vi.mock('./session', () => ({
  useSession: () => ({
    api: { agent: { createTurn: mocks.create, events: mocks.events, cancel: mocks.cancel } },
    call: (signal?: AbortSignal) => ({ signal }),
    invalidate: mocks.invalidate,
  }),
}));
vi.mock('./api', () => ({
  expired: (error: unknown) => error instanceof Error && error.message === '401',
  uncertain: () => true,
  problemText: () => 'network failure',
}));
vi.mock('./connector-screen', () => ({ ConnectorScreen: () => null }));
vi.mock('./widget-card', () => ({ NativeWidget: () => null }));
vi.mock('./ui', () => ({
  Action: () => null,
  Field: () => null,
  Copy: ({ children }: PropsWithChildren) => children,
  Card: ({ children }: PropsWithChildren) => children,
  Page: ({ children }: PropsWithChildren) => children,
  Problem: () => null,
  Loading: () => null,
  Mascot: () => null,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.clearAllMocks();
});
async function start() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const complete = deferred<void>();
  const cancel = deferred<never>();
  mocks.create.mockResolvedValue({ runId: 'run', conversationId: 'conversation' });
  mocks.events.mockImplementation(async function* () {
    yield { type: 'turn.started' };
    await complete.promise;
    yield { type: 'turn.completed' };
  });
  mocks.cancel.mockReturnValue(cancel.promise);
  await act(async () => {
    renderer = create(createElement(ChatScreen));
  });
  await act(async () => renderer.root.findByType(Field).props.onChangeText('Synthetic input'));
  await act(async () => renderer.root.findByProps({ testID: 'chat-send' }).props.onPress());
  const stop = renderer.root
    .findAllByType(Action)
    .find((node) => node.props.children === '停止回复');
  expect(stop).toBeDefined();
  await act(async () => stop!.props.onPress());
  return { complete, cancel };
}
describe('mobile stream and cancellation races', () => {
  it('does not turn a completed stream back into running when cancellation fails late', async () => {
    const { complete, cancel } = await start();
    await act(async () => complete.resolve());
    await act(async () => cancel.reject(new Error('network')));
    expect(
      renderer.root.findAllByType(Action).some((node) => node.props.children === '停止回复'),
    ).toBe(false);
    expect(renderer.root.findByType(Field).props.editable).toBe(true);
  });
  it('aborts outstanding cancellation and ignores a stale 401 after leaving the screen', async () => {
    const { complete, cancel } = await start();
    const signal = mocks.cancel.mock.calls[0]?.[2]?.signal as AbortSignal;
    await act(async () => renderer.unmount());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      cancel.reject(new Error('401'));
      complete.resolve();
    });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
