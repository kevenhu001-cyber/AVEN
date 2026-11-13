import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@aven/contracts';
import { Workspace } from './workspace';
import { MessageContent } from './message-content';
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  createTurn: vi.fn(),
  events: vi.fn(),
  copy: vi.fn(),
  expired: vi.fn(),
}));
vi.mock('./api', () => ({
  api: { agent: mocks },
  webCall: () => ({}),
  errorText: () => '请求失败',
  authExpired: () => false,
  writeUncertain: () => true,
}));
vi.mock('./modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}));
vi.mock('./plugins/connector-dialog', () => ({
  ConnectorDialog: ({ onResult }: { onResult: (value: unknown) => void }) =>
    createElement(
      'button',
      {
        'aria-label': '模拟连接器结果',
        onClick: () =>
          onResult({
            key: 'connector-result',
            pluginId: 'mock',
            pluginName: '合成连接器',
            actionTitle: '查询示例',
            summary: '合成连接器结果',
            providerMode: 'mock',
            widgets: [],
          }),
      },
      '返回示例',
    ),
}));
const at = '2026-11-13T00:00:00.000Z';
const me: MeResponse = {
  user: {
    id: '0b3d34ed-e500-442d-aa3b-3942ba74cbd1',
    displayName: '合成用户',
    email: 'ui@example.test',
    emailVerified: true,
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
  },
  session: {
    id: '9cd7978d-c111-4891-8e22-916c6d9b755e',
    client: 'web',
    userAgent: null,
    createdAt: at,
    lastSeenAt: at,
    expiresAt: at,
    revokedAt: null,
    current: true,
  },
};
let renderer: ReactTestRenderer;
const props = {
  me,
  suspended: false,
  problem: '',
  onRetry: vi.fn(),
  onExpired: mocks.expired,
  onLogout: vi.fn(),
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.copy } });
  vi.clearAllMocks();
  mocks.runtime.mockResolvedValue({ providerMode: 'mock', externalActions: false });
  mocks.createTurn.mockResolvedValue({ runId: 'run-1', conversationId: 'conversation-1' });
  mocks.events.mockImplementation(async function* () {
    yield { type: 'message.delta', sequence: 1, text: '**示例**\n\n1. 开始' };
    yield { type: 'turn.completed', sequence: 2 };
  });
  mocks.copy.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    renderer = create(createElement(Workspace, props));
  });
}
async function send() {
  await act(async () =>
    renderer.root.findByProps({ id: 'chat-input' }).props.onChange({ target: { value: '规划' } }),
  );
  await act(async () =>
    renderer.root
      .findByProps({ className: 'chat-composer' })
      .props.onSubmit({ preventDefault() {} }),
  );
}
function tabs() {
  return renderer.root.findByProps({ 'aria-label': '底部导航' }).findAllByType('button');
}
describe('chat workspace interactions', () => {
  it('preserves conversation and unsent draft across navigation without resending', async () => {
    await mount();
    await send();
    await act(async () =>
      renderer.root
        .findByProps({ id: 'chat-input' })
        .props.onChange({ target: { value: '未发送草稿' } }),
    );
    await act(async () => tabs()[4]!.props.onClick());
    expect(renderer.root.findByProps({ className: 'workspace-chat-host' }).props.hidden).toBe(true);
    await act(async () => tabs()[0]!.props.onClick());
    expect(renderer.root.findByProps({ id: 'chat-input' }).props.value).toBe('未发送草稿');
    expect(renderer.root.findByType(MessageContent).props.text).toContain('**示例**');
    expect(mocks.createTurn).toHaveBeenCalledTimes(1);
  });
  it('copies the actual streamed reply and starts a clean new conversation', async () => {
    await mount();
    await send();
    await act(async () => renderer.root.findByProps({ 'aria-label': '复制回复' }).props.onClick());
    expect(mocks.copy).toHaveBeenCalledWith('**示例**\n\n1. 开始');
    await act(async () =>
      renderer.root.findByProps({ 'aria-label': '开始新对话' }).props.onClick(),
    );
    expect(renderer.root.findAllByType(MessageContent)).toHaveLength(0);
    expect(renderer.root.findByProps({ id: 'chat-input' }).props.value).toBe('');
    expect(mocks.createTurn).toHaveBeenCalledTimes(1);
  });
  it('hides and clears replies when the session is suspended', async () => {
    await mount();
    await send();
    await act(async () => renderer.update(createElement(Workspace, { ...props, suspended: true })));
    expect(renderer.root.findAllByType(MessageContent)).toHaveLength(0);
    await act(async () => renderer.update(createElement(Workspace, props)));
    expect(renderer.root.findAllByType(MessageContent)).toHaveLength(0);
    expect(mocks.events).toHaveBeenCalledTimes(1);
  });
  it('keeps connector results in message order and discards them on session suspension', async () => {
    let timestamp = 1;
    vi.spyOn(Date, 'now').mockImplementation(() => timestamp);
    await mount();
    await act(async () => renderer.root.findByProps({ 'aria-label': '连接器' }).props.onClick());
    await act(async () =>
      renderer.root.findByProps({ 'aria-label': '模拟连接器结果' }).props.onClick(),
    );
    timestamp = 2;
    await send();
    expect(renderer.root.findAllByType(MessageContent).map((node) => node.props.text)).toEqual([
      '合成连接器结果',
      '**示例**\n\n1. 开始',
    ]);
    await act(async () => renderer.update(createElement(Workspace, { ...props, suspended: true })));
    await act(async () => renderer.update(createElement(Workspace, props)));
    expect(renderer.root.findAllByType(MessageContent)).toHaveLength(0);
  });
  it('labels a configured live model instead of claiming Mock', async () => {
    mocks.runtime.mockResolvedValueOnce({ providerMode: 'live', externalActions: false });
    await mount();
    const serialized = JSON.stringify(renderer.toJSON());
    expect(serialized).toContain('真实模型');
    expect(serialized).not.toContain('Mock 模拟回复');
  });
  it('disables sending when runtime state cannot be verified', async () => {
    mocks.runtime.mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(renderer.root.findByProps({ id: 'chat-input' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('暂时无法确认模型状态');
    expect(mocks.createTurn).not.toHaveBeenCalled();
  });
  it('escapes raw HTML while rendering readable lists and code', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '**说明**\n\n1. <script>alert(1)</script>\n\n```html\n<img onerror=alert(2)>\n```',
      }),
    );
    expect(html).toContain('<strong>说明</strong>');
    expect(html).toContain('<ol>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
});
