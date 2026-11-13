import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatBubble, Composer, TimeDivider, dark } from './ui';

vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Alert: { alert: () => undefined },
  Pressable: ({ children }: { children?: unknown }) => children,
  ScrollView: ({ children }: { children?: unknown }) => children,
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Switch: () => null,
  Text: ({ children }: { children?: unknown }) => children,
  TextInput: ({ children }: { children?: unknown }) => children,
  useColorScheme: () => 'dark',
  View: ({ children }: { children?: unknown }) => children,
}));

let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.clearAllMocks();
});

describe('mobile chat surfaces', () => {
  it('renders assistant and user bubbles with distinct alignment roles', async () => {
    await act(async () => {
      renderer = create(
        createElement(
          'root',
          {},
          createElement(ChatBubble, { role: 'user' }, '提问'),
          createElement(ChatBubble, { role: 'assistant' }, '回答'),
        ),
      );
    });
    const bubbles = renderer.root.findAllByType(ChatBubble);
    expect(bubbles.map((node) => node.props.role)).toEqual(['user', 'assistant']);
    expect(renderer.toJSON()).toBeTruthy();
  });

  it('renders a time divider with the given label', async () => {
    await act(async () => {
      renderer = create(createElement(TimeDivider, {}, '今天 11:42'));
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('今天 11:42');
  });

  it('exposes connector, send and stop affordances on the composer', async () => {
    const onPlugins = vi.fn();
    const onSend = vi.fn();
    const onStop = vi.fn();
    await act(async () => {
      renderer = create(
        createElement(Composer, {
          value: '你好',
          onChangeText: () => undefined,
          onSend,
          onStop,
          onPlugins,
          busy: false,
        }),
      );
    });
    const byLabel = (label: string) =>
      renderer.root.findAll((node) => node.props?.accessibilityLabel === label);
    expect(byLabel('连接器')).toHaveLength(1);
    expect(byLabel('发送消息')).toHaveLength(1);
    expect(byLabel('停止回复')).toHaveLength(0);
    await act(async () => byLabel('连接器')[0]!.props.onPress());
    await act(async () => byLabel('发送消息')[0]!.props.onPress());
    expect(onPlugins).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () =>
      renderer.update(
        createElement(Composer, {
          value: '你好',
          onChangeText: () => undefined,
          onSend,
          onStop,
          onPlugins,
          busy: true,
        }),
      ),
    );
    const stops = renderer.root.findAll((node) => node.props?.accessibilityLabel === '停止回复');
    expect(stops).toHaveLength(1);
    await act(async () => stops[0]!.props.onPress());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the dark palette free of shadows and gradients', () => {
    expect(dark.canvas).toBe('#000000');
    expect(Object.keys(dark)).not.toContain('shadow');
  });
});
