import { createElement, type PropsWithChildren } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatScreen } from './chat-screen';
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
  Copy: ({ children }: PropsWithChildren) => children,
  Card: ({ children }: PropsWithChildren) => children,
  Page: ({ children }: PropsWithChildren) => children,
  Problem: () => null,
  Loading: () => null,
  Mascot: () => null,
  ChatBubble: ({ children }: PropsWithChildren) => children,
  TimeDivider: ({ children }: PropsWithChildren) => children,
  Composer: ({
    value,
    onChangeText,
    onSend,
    onStop,
    busy,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    onSend: () => void;
    onStop: () => void;
    busy: boolean;
  }) =>
    createElement('composer', {
      composer: true,
      value,
      onChangeText,
      onSend,
      onStop,
      busy,
    }),
  dark: { canvas: '#000000' },
  usePalette: () => ({
    canvas: '#000000',
    surface: '#141416',
    'surface-raised': '#1C1C1E',
    'surface-hover': '#252528',
    border: '#28282C',
    'border-strong': '#38383E',
    text: '#F5F5F7',
    'text-secondary': '#8E8E93',
    'text-tertiary': '#71717A',
    'user-bubble': '#2C2C30',
    'user-bubble-text': '#F5F5F7',
    accent: '#F5B544',
    'accent-text': '#FFFFFF',
    'send-bg': '#FFFFFF',
    'send-text': '#000000',
    'mascot-bg': '#FFFFFF',
    'mascot-eye': '#000000',
  }),
}));
vi.mock('react-native', () => ({
  View: ({ children }: PropsWithChildren) => children,
  ScrollView: ({ children }: PropsWithChildren) => children,
  Text: ({ children }: PropsWithChildren) => children,
  Pressable: ({ children }: PropsWithChildren) => children,
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
function composer() {
  return renderer.root.findAllByProps({ composer: true })[0]!.props;
}
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
  await act(async () => composer().onChangeText('Synthetic input'));
  await act(async () => composer().onSend());
  expect(composer().busy).toBe(true);
  await act(async () => composer().onStop());
  return { complete, cancel };
}
describe('mobile stream and cancellation races', () => {
  it('does not turn a completed stream back into running when cancellation fails late', async () => {
    const { complete, cancel } = await start();
    await act(async () => complete.resolve());
    await act(async () => cancel.reject(new Error('network')));
    expect(composer().busy).toBe(false);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
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
