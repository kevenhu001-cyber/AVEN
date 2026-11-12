'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeResponse } from '@aven/contracts';
import { api, authExpired, errorText, webCall } from './api';

export function usePersonalSession() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [problem, setProblem] = useState('');
  const identity = useRef<MeResponse | null>(null);
  const checker = useRef<AbortController | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const abortCheck = useCallback(() => {
    checker.current?.abort();
    checker.current = null;
    pending.current = null;
  }, []);
  const invalidate = useCallback(() => {
    abortCheck();
    identity.current = null;
    setMe(null);
    setProblem('');
    setStatus('ready');
  }, [abortCheck]);
  const check = useCallback(() => {
    if (pending.current) return pending.current;
    const controller = new AbortController();
    checker.current = controller;
    const request = api.auth
      .me(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        identity.current = result;
        setMe(result);
        setStatus('ready');
        setProblem('');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (authExpired(error)) {
          identity.current = null;
          setMe(null);
          setStatus('ready');
          setProblem('');
        } else {
          setStatus('error');
          setProblem(errorText(error));
        }
      })
      .finally(() => {
        if (checker.current === controller) {
          checker.current = null;
          pending.current = null;
        }
      });
    pending.current = request;
    return request;
  }, []);
  const recheck = useCallback(
    (hidePrivate = false) => {
      if (hidePrivate && identity.current) setStatus('checking');
      return check();
    },
    [check],
  );
  useEffect(() => {
    if (!document.hidden) void check();
    const visible = () => {
      if (document.hidden) {
        abortCheck();
        if (identity.current) setStatus('checking');
      } else void recheck();
    };
    const focus = () => {
      if (!document.hidden) void recheck();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (!document.hidden) void recheck(event.persisted);
    };
    const changed = () => {
      abortCheck();
      if (identity.current) setStatus('checking');
      if (!document.hidden) void check();
    };
    const offline = () => {
      abortCheck();
      setStatus('error');
      setProblem('当前离线。恢复连接后会重新验证会话。');
    };
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('aven-session');
      channel.current.onmessage = changed;
    }
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('offline', offline);
    window.addEventListener('online', focus);
    return () => {
      abortCheck();
      channel.current?.close();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', focus);
    };
  }, [abortCheck, check, recheck]);
  async function signedIn() {
    // A pre-login 401 must not win over the newly issued cookie.
    abortCheck();
    channel.current?.postMessage('changed');
    await check();
  }
  async function logout() {
    abortCheck();
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
  return { me, status, problem, invalidate, recheck, signedIn, logout };
}
