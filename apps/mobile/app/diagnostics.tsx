import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import { colors, fontSize, lineHeight, radius, space } from '@aven/design-tokens';

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

function errorCode(error: unknown): string {
  return error instanceof ApiClientError ? (error.apiCode ?? error.code) : 'NETWORK_ERROR';
}

/* ─── Animated loading dots ─── */
function LoadingDots({ color }: { color: string }) {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, []);
  return (
    <View style={styles.dotsRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor: color,
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              transform: [
                { scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

/* ─── Status dot + label ─── */
function StatusBadge({
  kind,
  theme,
}: {
  kind: State['kind'];
  theme: (typeof colors)[keyof typeof colors];
}) {
  const map = {
    idle: { color: theme['foreground-tertiary'], label: '待检查' },
    loading: { color: theme.warning, label: '检查中' },
    success: { color: theme.success, label: '已连通' },
    error: { color: theme.destructive, label: '未连通' },
    cancelled: { color: theme['foreground-tertiary'], label: '已取消' },
  };
  const { color, label } = map[kind];
  return (
    <View style={styles.badge}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

export default function FoundationScreen() {
  const theme = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [readyState, setReadyState] = useState<State>({ kind: 'idle' });
  const active = useRef<AbortController | null>(null);
  const readyActive = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      readyActive.current?.abort();
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
        setState({ kind: 'error', code: errorCode(error) });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }
  async function checkReady() {
    if (!config.client) return;
    readyActive.current?.abort();
    const controller = new AbortController();
    readyActive.current = controller;
    setReadyState({ kind: 'loading' });
    try {
      const result = await config.client.getReadiness(controller.signal);
      if (readyActive.current === controller)
        setReadyState({ kind: 'success', requestId: result.request_id });
    } catch (error) {
      if (readyActive.current === controller && !controller.signal.aborted)
        setReadyState({ kind: 'error', code: errorCode(error) });
    } finally {
      if (readyActive.current === controller) readyActive.current = null;
    }
  }
  const disabled = !config.client || state.kind === 'loading';
  const readyDisabled = !config.client || readyState.kind === 'loading';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ─── Header ─── */}
        <View style={styles.header}>
          <Text style={[styles.brand, { color: theme.foreground }]}>AVEN</Text>
          <View style={[styles.versionPill, { backgroundColor: theme['surface-secondary'] }]}>
            <Text style={[styles.versionText, { color: theme['foreground-tertiary'] }]}>M0</Text>
          </View>
        </View>

        {/* ─── Hero ─── */}
        <View style={styles.hero}>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.foreground }]}>
            从可靠的连接{'\n'}开始
          </Text>
          <Text style={[styles.subtitle, { color: theme['foreground-secondary'] }]}>
            Expo 原生诊断页 · 不是 WebView，也不是已完成产品
          </Text>
        </View>

        {/* ─── API Connection Card ─── */}
        <View style={[styles.card, { backgroundColor: theme['surface-secondary'] }]}>
          <View style={styles.cardHeader}>
            <Text
              accessibilityRole="header"
              style={[styles.cardTitle, { color: theme.foreground }]}
            >
              API 连接
            </Text>
            <StatusBadge kind={state.kind} theme={theme} />
          </View>

          <Text style={[styles.cardBody, { color: theme['foreground-secondary'] }]}>
            {config.error ?? config.origin}
          </Text>

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled, busy: state.kind === 'loading' }}
              disabled={disabled}
              onPress={() => void check()}
              style={({ pressed }) => [
                styles.pillButton,
                { backgroundColor: theme.primary, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
              ]}
            >
              {state.kind === 'loading' ? (
                <LoadingDots color={theme['primary-foreground']} />
              ) : (
                <Text style={[styles.pillButtonText, { color: theme['primary-foreground'] }]}>
                  {state.kind === 'error' ? '重试' : '检查连接'}
                </Text>
              )}
            </Pressable>

            {state.kind === 'loading' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  active.current?.abort();
                  active.current = null;
                  setState({ kind: 'cancelled' });
                }}
                style={({ pressed }) => [
                  styles.pillButton,
                  styles.ghostButton,
                  { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.pillButtonText, { color: theme['foreground-secondary'] }]}>
                  取消
                </Text>
              </Pressable>
            )}
          </View>

          {/* Result area */}
          <View accessibilityLiveRegion="polite">
            {state.kind === 'idle' && (
              <Text style={[styles.hint, { color: theme['foreground-tertiary'] }]}>
                存活探针不证明业务就绪
              </Text>
            )}
            {state.kind === 'success' && (
              <View style={styles.resultBlock}>
                <Text style={[styles.resultText, { color: theme.success }]}>API 进程可访问</Text>
                <Text selectable style={[styles.mono, { color: theme['foreground-tertiary'] }]}>
                  {state.requestId}
                </Text>
              </View>
            )}
            {state.kind === 'error' && (
              <Text style={[styles.resultText, { color: theme.destructive }]}>
                连接未确认 · {state.code}
              </Text>
            )}
          </View>
        </View>

        {/* ─── Readiness Card ─── */}
        <View style={[styles.card, { backgroundColor: theme['surface-secondary'] }]}>
          <View style={styles.cardHeader}>
            <Text
              accessibilityRole="header"
              style={[styles.cardTitle, { color: theme.foreground }]}
            >
              依赖就绪
            </Text>
            <StatusBadge kind={readyState.kind} theme={theme} />
          </View>

          <Text style={[styles.cardBody, { color: theme['foreground-secondary'] }]}>
            数据库、Redis 与迁移版本
          </Text>

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: readyDisabled, busy: readyState.kind === 'loading' }}
              disabled={readyDisabled}
              onPress={() => void checkReady()}
              style={({ pressed }) => [
                styles.pillButton,
                {
                  backgroundColor: theme.primary,
                  opacity: readyDisabled ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {readyState.kind === 'loading' ? (
                <LoadingDots color={theme['primary-foreground']} />
              ) : (
                <Text style={[styles.pillButtonText, { color: theme['primary-foreground'] }]}>
                  {readyState.kind === 'error' ? '重试' : '检查依赖'}
                </Text>
              )}
            </Pressable>

            {readyState.kind === 'loading' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  readyActive.current?.abort();
                  readyActive.current = null;
                  setReadyState({ kind: 'cancelled' });
                }}
                style={({ pressed }) => [
                  styles.pillButton,
                  styles.ghostButton,
                  { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.pillButtonText, { color: theme['foreground-secondary'] }]}>
                  取消
                </Text>
              </Pressable>
            )}
          </View>

          <View accessibilityLiveRegion="polite">
            {readyState.kind === 'idle' && (
              <Text style={[styles.hint, { color: theme['foreground-tertiary'] }]}>
                依赖就绪不代表业务功能已完成
              </Text>
            )}
            {readyState.kind === 'success' && (
              <View style={styles.resultBlock}>
                <Text style={[styles.resultText, { color: theme.success }]}>全部依赖已就绪</Text>
                <Text style={[styles.hint, { color: theme['foreground-tertiary'] }]}>
                  数据库、Redis 与迁移版本均已确认
                </Text>
                <Text selectable style={[styles.mono, { color: theme['foreground-tertiary'] }]}>
                  {readyState.requestId}
                </Text>
              </View>
            )}
            {readyState.kind === 'error' && (
              <Text style={[styles.resultText, { color: theme.destructive }]}>
                依赖未就绪 · {readyState.code}
              </Text>
            )}
          </View>
        </View>

        {/* ─── Footer note ─── */}
        <Text style={[styles.footer, { color: theme['foreground-tertiary'] }]}>
          数据库、队列、账号、机会、授权和 AI 均尚未开放。{'\n'}JS
          导出成功不等于原生包或真机验收通过。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space[24],
    paddingTop: space[16],
    paddingBottom: space[48],
    gap: space[20],
    flexGrow: 1,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[12],
    paddingBottom: space[4],
  },
  brand: {
    fontSize: fontSize.h3,
    fontWeight: '700',
    letterSpacing: 3,
  },
  versionPill: {
    paddingHorizontal: space[8],
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  versionText: {
    fontSize: fontSize.micro,
    fontWeight: '500',
    letterSpacing: 1,
  },

  /* Hero */
  hero: {
    paddingTop: space[24],
    paddingBottom: space[8],
    gap: space[12],
  },
  heading: {
    fontSize: 32,
    lineHeight: 32 * 1.2,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.body,
    lineHeight: fontSize.body * lineHeight.body,
  },

  /* Cards */
  card: {
    borderRadius: radius.xl,
    padding: space[20],
    gap: space[16],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: fontSize.h3,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  cardBody: {
    fontSize: fontSize.body,
    lineHeight: fontSize.body * lineHeight.body,
  },

  /* Status badge */
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeLabel: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },

  /* Buttons */
  buttonRow: {
    flexDirection: 'row',
    gap: space[12],
  },
  pillButton: {
    height: 44,
    paddingHorizontal: space[24],
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ghostButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  pillButtonText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },

  /* Loading dots */
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    height: 20,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  /* Results */
  resultBlock: {
    gap: space[4],
  },
  resultText: {
    fontSize: fontSize.body,
    lineHeight: fontSize.body * lineHeight.body,
    fontWeight: '500',
  },
  hint: {
    fontSize: fontSize['body-sm'],
    lineHeight: fontSize['body-sm'] * lineHeight['body-sm'],
  },
  mono: {
    fontSize: fontSize.caption,
    lineHeight: fontSize.caption * lineHeight.caption,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },

  /* Footer */
  footer: {
    fontSize: fontSize.caption,
    lineHeight: fontSize.caption * lineHeight.caption,
    textAlign: 'center',
    marginTop: 'auto' as unknown as number,
    paddingTop: space[24],
  },
});
