import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiClientError, createApiClient } from '@aven/api-client';
import { colors, fontSize, radius, space } from '@aven/design-tokens';

const configuredOrigin = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';
function connectionConfig() {
  if (!configuredOrigin)
    return {
      error: '尚未配置 EXPO_PUBLIC_API_URL，请设置开发机局域网或 HTTPS API 地址。',
    } as const;
  try {
    const url = new URL(configuredOrigin);
    const client = createApiClient({ baseUrl: configuredOrigin });
    if (Platform.OS !== 'web' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      return {
        error: '真机不能访问开发机的 localhost，请改为设备可达的局域网 IP 或 HTTPS 地址。',
      } as const;
    }
    return { client, origin: url.origin } as const;
  } catch {
    return { error: 'API 地址配置无效，需要不含凭据、路径或查询参数的 HTTP(S) origin。' } as const;
  }
}
const config = connectionConfig();
type State =
  | { kind: 'idle' | 'loading' | 'cancelled' }
  | { kind: 'success'; requestId: string }
  | { kind: 'error'; code: string };

export default function FoundationScreen() {
  const theme = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [state, setState] = useState<State>({ kind: 'idle' });
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  async function check() {
    if (!config.client) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ kind: 'loading' });
    try {
      const result = await config.client.getLiveness(controller.signal);
      if (active.current === controller)
        setState({ kind: 'success', requestId: result.request_id });
    } catch (error) {
      if (active.current === controller && !controller.signal.aborted)
        setState({
          kind: 'error',
          code: error instanceof ApiClientError ? error.code : 'NETWORK_ERROR',
        });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }
  const disabled = !config.client || state.kind === 'loading';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.brand, { color: theme.foreground }]}>AVEN</Text>
        <Text style={[styles.meta, { color: theme['foreground-secondary'] }]}>
          M0 · 原生工程骨架
        </Text>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.foreground }]}>
          从可靠的连接开始。
        </Text>
        <Text style={[styles.body, { color: theme['foreground-secondary'] }]}>
          这是 Expo 原生诊断页，不是 WebView，也不是已完成产品。
        </Text>
        <View style={[styles.connection, { backgroundColor: theme['surface-secondary'] }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.foreground }]}>
            检查 API 连接
          </Text>
          <Text style={[styles.body, { color: theme['foreground-secondary'] }]}>
            {config.error ?? `API 地址：${config.origin}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled, busy: state.kind === 'loading' }}
            disabled={disabled}
            onPress={() => void check()}
            style={[styles.button, { backgroundColor: theme.primary }]}
          >
            <Text style={[styles.buttonText, { color: theme['primary-foreground'] }]}>
              {state.kind === 'loading'
                ? '正在检查…'
                : state.kind === 'error'
                  ? '重试连接'
                  : '检查连接'}
            </Text>
          </Pressable>
          {state.kind === 'loading' && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                active.current?.abort();
                active.current = null;
                setState({ kind: 'cancelled' });
              }}
              style={[styles.button, { borderWidth: 1, borderColor: theme['control-border'] }]}
            >
              <Text style={[styles.buttonText, { color: theme.foreground }]}>取消检查</Text>
            </Pressable>
          )}
          <View accessibilityLiveRegion="polite">
            {state.kind === 'idle' && (
              <Text style={[styles.body, { color: theme['foreground-secondary'] }]}>
                尚未检查。存活探针不证明业务就绪。
              </Text>
            )}
            {state.kind === 'success' && (
              <>
                <Text style={[styles.body, { color: theme.success }]}>API 进程可访问</Text>
                <Text selectable style={[styles.body, { color: theme['foreground-secondary'] }]}>
                  Request ID: {state.requestId}
                </Text>
              </>
            )}
            {state.kind === 'error' && (
              <Text style={[styles.body, { color: theme.destructive }]}>
                连接未确认，请检查地址与网络后重试。错误类型：{state.code}
              </Text>
            )}
            {state.kind === 'cancelled' && (
              <Text style={[styles.body, { color: theme['foreground-secondary'] }]}>
                已取消本次检查。
              </Text>
            )}
          </View>
        </View>
        <Text style={[styles.body, { color: theme['foreground-secondary'] }]}>
          数据库、队列、账号、机会、授权和 AI 均尚未开放。JS 导出成功不等于原生包或真机验收通过。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  content: { padding: space[24], gap: space[16], flexGrow: 1 },
  brand: { fontSize: fontSize.h3, fontWeight: '600', letterSpacing: 2 },
  meta: { fontSize: fontSize['body-sm'] },
  heading: { fontSize: fontSize.h1, lineHeight: 38, fontWeight: '600', marginTop: space[24] },
  title: { fontSize: fontSize.h2, fontWeight: '500' },
  body: { fontSize: fontSize['body-native'], lineHeight: 27 },
  connection: { padding: space[20], gap: space[16], borderRadius: radius.lg },
  button: {
    minHeight: 48,
    padding: space[12],
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: { fontSize: fontSize['body-native'], fontWeight: '500' },
});
