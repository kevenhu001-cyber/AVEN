'use client';

import { useRef, useState, type FormEvent } from 'react';
import { LoginRequestSchema, RegisterRequestSchema } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorText } from './api';
import { Mascot } from './mascot';

export function AuthForm({ onLogin }: { onLogin: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const input =
      mode === 'login'
        ? { email, password, client: 'web' as const }
        : { email, password, displayName: name };
    if (!(mode === 'login' ? LoginRequestSchema : RegisterRequestSchema).safeParse(input).success) {
      setMessage(
        mode === 'register'
          ? '请输入有效邮箱、显示名和至少 12 个字符的密码。'
          : '请输入有效邮箱和密码。',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'register') {
        await api.auth.register({ email, password, displayName: name });
        setMode('login');
        setMessage('注册成功，请登录。邮箱验证完成后可发送连接邀请。');
      } else {
        await api.auth.loginWeb({ email, password });
        await onLogin();
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      lock.current = false;
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen personal-app">
      <section className="auth-card" aria-labelledby="auth-title">
        <Mascot large />
        <h1 id="auth-title">{mode === 'login' ? '回到你的 AVEN' : '从一次对话开始'}</h1>
        <p className="muted">聊聊想法，认识合适的人。每次分享，由你决定。</p>
        <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
          {mode === 'register' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-name">怎么称呼你</Label>
              <Input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
                required
                maxLength={120}
                disabled={busy}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-email">邮箱</Label>
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              maxLength={320}
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-password">密码</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 12 : 1}
              maxLength={128}
              required
              disabled={busy}
            />
          </div>
          {message && <Alert variant="warning">{message}</Alert>}
          <Button className="w-full" type="submit" disabled={busy}>
            {busy ? '正在验证…' : mode === 'login' ? '登录' : '创建账号'}
          </Button>
        </form>
        <Button
          variant="ghost"
          className="mb-3"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setPassword('');
            setMessage('');
          }}
        >
          {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
        </Button>
        <p className="small muted">开发验证版 · AI 使用 Mock 服务 · 尚未开放真实模型与邮箱连接</p>
        <a className="small muted" href="/diagnostics">
          工程诊断
        </a>
      </section>
    </main>
  );
}
