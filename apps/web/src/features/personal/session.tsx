'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MeResponse } from '@aven/contracts';
import { api, authExpired, errorText, webCall } from './api';

type SessionState = {
  me: MeResponse | null;
  status: 'checking' | 'ready' | 'error';
  problem: string;
  suspended: boolean;
  recheck: () => Promise<void>;
  invalidate: () => void;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [problem, setProblem] = useState('');
  const checker = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const invalidate = useCallback(() => {
    checker.current?.abort();
    setMe(null);
    setStatus('ready');
  }, []);

  const check = useCallback(() => {
    checker.current?.abort();
    const controller = new AbortController();
    checker.current = controller;
    return api.auth
      .me(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setMe(result);
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (authExpired(error)) {
          setMe(null);
          setStatus('ready');
        } else {
          setStatus('error');
          setProblem(errorText(error));
        }
      });
  }, []);

  const recheck = useCallback(async () => {
    setStatus('checking');
    setProblem('');
    await check();
  }, [check]);

  useEffect(() => {
    void check();
    const visible = () => {
      if (document.hidden) {
        checker.current?.abort();
        setStatus('checking');
      } else void recheck();
    };
    const offline = () => {
      checker.current?.abort();
      setProblem('当前离线。私人内容已隐藏，恢复连接后会重新验证会话。');
      setStatus('error');
    };
    const broadcast = () => {
      void recheck();
    };
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('aven-session');
      channel.current.onmessage = broadcast;
    }
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', broadcast);
    window.addEventListener('pageshow', broadcast);
    window.addEventListener('offline', offline);
    window.addEventListener('online', broadcast);
    return () => {
      checker.current?.abort();
      channel.current?.close();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', broadcast);
      window.removeEventListener('pageshow', broadcast);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', broadcast);
    };
  }, [check, recheck]);

  const logout = useCallback(async () => {
    setStatus('checking');
    try {
      await api.auth.logout(webCall());
      invalidate();
      channel.current?.postMessage('changed');
    } catch (error) {
      if (authExpired(error)) invalidate();
      else {
        setStatus('error');
        setProblem(errorText(error));
      }
    }
  }, [invalidate]);

  return (
    <SessionContext.Provider
      value={{
        me,
        status,
        problem,
        suspended: status !== 'ready',
        recheck,
        invalidate,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
