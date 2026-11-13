import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentChat } from './use-agent-chat';
const mocks = vi.hoisted(() => ({
  createTurn: vi.fn(),
  events: vi.fn(),
  cancel: vi.fn(),
  expired: vi.fn(),
}));
vi.mock('./api', () => ({
  api: { agent: mocks },
  webCall: (signal?: AbortSignal) => ({ signal }),
  authExpired: () => false,
  errorText: () => '连接中断',
  writeUncertain: () => true,
}));
let renderer: ReactTestRenderer;
let chat: ReturnType<typeof useAgentChat>;
function Harness({ suspended = false }: { suspended?: boolean }) {
  const value = useAgentChat(suspended, mocks.expired);
  useEffect(() => {
    chat = value;
  }, [value]);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(Harness));
  });
}
async function send(text = '计划') {
  await act(async () => chat.setDraft(text));
  await act(async () => chat.send());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.createTurn.mockResolvedValue({ runId: 'run-1', conversationId: 'conversation-1' });
  mocks.events.mockImplementation(async function* () {
    yield { type: 'message.delta', sequence: 1, text: '示例回复' };
    yield { type: 'turn.completed', sequence: 2 };
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
describe('chat request and privacy lifecycle', () => {
  it('prevents duplicate sends while creation is pending and retains the submitted text', async () => {
    const pending = deferred<{ runId: string; conversationId: string }>();
    mocks.createTurn.mockReturnValue(pending.promise);
    await mount();
    await send();
    await act(async () => {
      chat.send();
      chat.reset();
    });
    expect(mocks.createTurn).toHaveBeenCalledTimes(1);
    expect(chat.turns[0]?.input).toBe('计划');
    expect(chat.busy).toBe(true);
    await act(async () => pending.resolve({ runId: 'run-1', conversationId: 'conversation-1' }));
    expect(chat.turns[0]?.answer).toBe('示例回复');
    expect(chat.busy).toBe(false);
  });
  it('uses the original idempotency key when the creation result is uncertain', async () => {
    mocks.createTurn.mockRejectedValueOnce(new Error('network'));
    await mount();
    await send();
    const turn = chat.turns[0]!;
    expect(turn.status).toBe('unknown');
    await act(async () => chat.retryCreate(turn));
    expect(mocks.createTurn.mock.calls[1]?.[1]).toBe(mocks.createTurn.mock.calls[0]?.[1]);
    expect(chat.turns).toHaveLength(1);
    expect(chat.turns[0]?.status).toBe('completed');
  });
  it('clears derived text on stream failure and starts an explicit replay from zero', async () => {
    mocks.events.mockImplementationOnce(async function* () {
      yield { type: 'message.delta', sequence: 1, text: 'private-partial' };
      throw new Error('closed');
    });
    await mount();
    await send();
    expect(chat.turns[0]?.answer).toBe('');
    expect(chat.turns[0]?.status).toBe('disconnected');
    await act(async () => chat.resume(chat.turns[0]!));
    expect(mocks.events.mock.calls[1]?.[1]).toBe(0);
    expect(chat.turns[0]?.answer).toBe('示例回复');
  });
  it('removes private derived text on suspension and requires an explicit reread', async () => {
    await mount();
    await send();
    await act(async () => renderer.update(createElement(Harness, { suspended: true })));
    expect(chat.turns[0]?.answer).toBe('');
    expect(chat.turns[0]?.status).toBe('disconnected');
    await act(async () => renderer.update(createElement(Harness, { suspended: false })));
    expect(mocks.events).toHaveBeenCalledTimes(1);
    await act(async () => chat.resume(chat.turns[0]!));
    expect(chat.turns[0]?.answer).toBe('示例回复');
  });
  it('clears partial text and explains an upstream rate or quota failure', async () => {
    mocks.events.mockImplementationOnce(async function* () {
      yield { type: 'message.delta', sequence: 1, text: 'unfinished-private-text' };
      yield { type: 'turn.failed', sequence: 2, error_code: 'PROVIDER_RATE_LIMITED' };
    });
    await mount();
    await send();
    expect(chat.turns[0]?.answer).toBe('');
    expect(chat.turns[0]?.status).toBe('failed');
    expect(chat.turns[0]?.error).toContain('额度');
    expect(mocks.createTurn).toHaveBeenCalledTimes(1);
  });
  it('starts a new conversation without resending or reusing its old conversation id', async () => {
    await mount();
    await send();
    await act(async () => {
      chat.setDraft('旧草稿');
      chat.reset();
    });
    expect(chat.draft).toBe('');
    expect(chat.turns).toEqual([]);
    await send('新的问题');
    expect(mocks.createTurn.mock.calls[1]?.[0]).toEqual({ input: '新的问题' });
  });
});
