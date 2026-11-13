import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { ApiClientError, createApiClient } from '@aven/api-client';
import type { MeResponse } from '@aven/contracts';

const origin = process.env.EXPO_PUBLIC_API_URL?.trim();
function clientConfig() {
  try {
    if (!origin) return null;
    const url = new URL(origin);
    if (!__DEV__ && url.protocol !== 'https:') return null;
    return createApiClient({ baseUrl: origin });
  } catch {
    return null;
  }
}
const api = clientConfig();
export default function PersonalScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('原生个人端 · 登录基础；对话与连接器仍待接入。');
  const token = useRef('');
  const controller = useRef<AbortController | null>(null);
  function clear() {
    controller.current?.abort();
    token.current = '';
    setMe(null);
    setPassword('');
    setBusy(false);
  }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        const previous = token.current;
        clear();
        if (api && previous)
          void api.auth
            .logout({ auth: { kind: 'mobile', bearerToken: previous } })
            .catch(() => undefined);
        setMessage('已进入后台，本地会话已隐藏。请重新登录；服务器会话可在账号端撤销。');
      }
    });
    return () => {
      subscription.remove();
      controller.current?.abort();
      token.current = '';
    };
  }, []);
  async function login() {
    if (!api || busy) return;
    setBusy(true);
    const current = new AbortController();
    controller.current = current;
    const secret = password;
    setPassword('');
    try {
      const result = await api.auth.loginMobile({ email, password: secret }, current.signal);
      if (current.signal.aborted) return;
      token.current = result.sessionToken!;
      const verified = await api.auth.meMobile({
        auth: { kind: 'mobile', bearerToken: token.current },
        signal: current.signal,
      });
      if (!current.signal.aborted) {
        setMe(verified);
        setMessage('已通过服务器验证。令牌只保留在当前前台内存中。');
      }
    } catch (error) {
      if (!current.signal.aborted) {
        clear();
        setMessage(
          error instanceof ApiClientError && error.status === 401
            ? '邮箱或密码未通过验证。'
            : '登录结果未确认，请重试。',
        );
      }
    } finally {
      if (controller.current === current) setBusy(false);
    }
  }
  async function logout() {
    const value = token.current;
    clear();
    if (api && value)
      try {
        await api.auth.logout({ auth: { kind: 'mobile', bearerToken: value } });
        setMessage('服务器会话已退出。');
      } catch {
        setMessage('本地会话已清除；服务器撤销结果未确认，请在账号端核对。');
      }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#101010' }}>
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={{ color: 'white', fontSize: 28 }}>
          AVEN
        </Text>
        <Text accessibilityLiveRegion="polite" style={{ color: '#cccccc' }}>
          {message}
        </Text>
        {!api && (
          <Text style={{ color: '#ffb4b4' }}>
            请配置有效的 EXPO_PUBLIC_API_URL，发布环境要求 HTTPS。
          </Text>
        )}
        {me ? (
          <View style={{ gap: 16 }}>
            <Text style={{ color: 'white' }}>你好，{me.user.displayName}</Text>
            <Pressable accessibilityRole="button" onPress={() => void logout()}>
              <Text style={{ color: 'white', padding: 16 }}>退出登录</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <TextInput
              accessibilityLabel="邮箱"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              editable={!busy}
              placeholder="邮箱"
              placeholderTextColor="#aaa"
              style={{
                color: 'white',
                borderColor: '#888',
                borderWidth: 1,
                padding: 16,
                borderRadius: 16,
              }}
            />
            <TextInput
              accessibilityLabel="密码"
              secureTextEntry
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
              editable={!busy}
              placeholder="密码"
              placeholderTextColor="#aaa"
              style={{
                color: 'white',
                borderColor: '#888',
                borderWidth: 1,
                padding: 16,
                borderRadius: 16,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !api, busy }}
              disabled={busy || !api}
              onPress={() => void login()}
            >
              <Text
                style={{
                  backgroundColor: 'white',
                  color: 'black',
                  padding: 16,
                  borderRadius: 16,
                  textAlign: 'center',
                }}
              >
                {busy ? '正在登录…' : '登录'}
              </Text>
            </Pressable>
          </View>
        )}
        <Link href="/diagnostics" style={{ color: '#aaa', padding: 16 }}>
          工程诊断
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}
