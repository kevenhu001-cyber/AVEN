import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type { MeResponse } from '@aven/contracts';
import { type MobileApi, mobileCall, expired, problemText } from './api';
import { Action, Copy, Loading, Mascot, Page, Problem } from './ui';

export type Session = {
  api: MobileApi;
  me: MeResponse;
  call: (signal?: AbortSignal) => ReturnType<typeof mobileCall>;
  invalidate: () => void;
  refresh: () => void;
  logout: () => Promise<void>;
};
const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session required.');
  return value;
}
export function SessionProvider({
  api,
  origin,
  renderAuth,
  children,
}: PropsWithChildren<{
  api: MobileApi;
  origin: string;
  renderAuth: (login: (token: string) => Promise<void>) => React.ReactNode;
}>) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready' | 'anonymous' | 'error'>('checking');
  const [message, setMessage] = useState('');
  const token = useRef<string | null>(null);
  const storageKey = useRef('');
  const controller = useRef<AbortController | null>(null);
  const active = useRef(AppState.currentState === 'active');
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    token.current = null;
    setMe(null);
    setStatus('anonymous');
    if (storageKey.current)
      void SecureStore.deleteItemAsync(storageKey.current).catch(() =>
        setMessage('清除设备凭据失败，请在系统设置清除应用数据。'),
      );
  }, []);
  const check = useCallback(async () => {
    const version = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setMe(null);
    setStatus('checking');
    setMessage('');
    try {
      if (!storageKey.current)
        storageKey.current =
          'aven.session.' +
          (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, origin));
      const saved = token.current ?? (await SecureStore.getItemAsync(storageKey.current));
      if (abort.signal.aborted || version !== generation.current) return;
      if (!saved) {
        setStatus('anonymous');
        return;
      }
      const result = await api.auth.me(abort.signal, mobileCall(saved, abort.signal));
      if (abort.signal.aborted || version !== generation.current || !active.current) return;
      if (result.session.client !== 'mobile') throw new Error('Unexpected session.');
      token.current = saved;
      setMe(result);
      setStatus('ready');
    } catch (error) {
      if (abort.signal.aborted || version !== generation.current) return;
      if (expired(error)) invalidate();
      else {
        setMessage(problemText(error));
        setStatus('error');
      }
    }
  }, [api, origin, invalidate]);
  useEffect(() => {
    void check();
    const listener = AppState.addEventListener('change', (state) => {
      active.current = state === 'active';
      if (!active.current) {
        generation.current++;
        controller.current?.abort();
        setMe(null);
        setStatus('checking');
      } else void check();
    });
    return () => {
      generation.current++;
      controller.current?.abort();
      listener.remove();
    };
  }, [check]);
  async function login(value: string) {
    if (!storageKey.current) throw new Error('Secure storage unavailable.');
    await SecureStore.setItemAsync(storageKey.current, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    token.current = value;
    await check();
  }
  if (status === 'anonymous') return renderAuth(login);
  if (status !== 'ready' || !me)
    return (
      <Page>
        <Mascot />
        <Copy title>正在确认当前会话</Copy>
        <Copy muted>私人内容暂时隐藏。恢复后重新从服务端读取。</Copy>
        <Problem message={message} />
        {status === 'checking' ? (
          <Loading />
        ) : (
          <Action onPress={() => void check()}>重新连接</Action>
        )}
        <Action secondary onPress={invalidate}>
          返回登录
        </Action>
      </Page>
    );
  const value: Session = {
    api,
    me,
    call: (signal) => mobileCall(token.current!, signal),
    invalidate,
    refresh: () => void check(),
    logout: async () => {
      try {
        await api.auth.logout(mobileCall(token.current!));
        invalidate();
      } catch (error) {
        if (expired(error)) invalidate();
        else throw error;
      }
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
