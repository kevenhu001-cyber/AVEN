'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeResponse } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api, authExpired, errorText, webCall } from './api';
import { AuthForm } from './auth-form';
import { Workspace } from './workspace';
import { Mascot } from './mascot';
import './personal.css';

export function PersonalApp() {
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

  async function signedIn() {
    channel.current?.postMessage('changed');
    await recheck();
  }

  async function logout() {
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
  }

  if (me)
    return (
      <Workspace
        key={me.user.id}
        me={me}
        suspended={status !== 'ready'}
        problem={problem}
        onRetry={() => void recheck()}
        onExpired={invalidate}
        onLogout={() => void logout()}
      />
    );

  if (status !== 'ready')
    return (
      <main className="personal-app auth-screen">
        <section className="auth-card flex flex-col items-center gap-4">
          <Mascot large state="thinking" />
          <h1>{status === 'checking' ? '正在验证会话' : '暂时无法连接'}</h1>
          {problem && <Alert variant="warning">{problem}</Alert>}
          {status === 'error' && <Button onClick={() => void recheck()}>重新连接</Button>}
        </section>
      </main>
    );

  return <AuthForm onLogin={signedIn} />;
}
