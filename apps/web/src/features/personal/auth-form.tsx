'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoginRequestSchema, RegisterRequestSchema } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from './api';
import { authErrorText } from './auth-errors';
import { ApiClientError } from '@aven/api-client';
import { AuthShell } from './auth-shell';
import { AuthPassword } from './auth-password';
import { PasswordRecovery } from './password-recovery';
import { AuthWelcome } from './auth-welcome';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { parseResetFragment } from './auth-reset-link';

export function AuthForm({
  onLogin,
  checking,
  connectionProblem,
  onRetry,
  onRecoveryOpen,
  onRecoveryClose,
  onReset,
}: {
  onLogin: () => Promise<void>;
  checking: boolean;
  connectionProblem: string;
  onRetry: () => void;
  onRecoveryOpen: () => void;
  onRecoveryClose: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    let active = true;
    const consume = () => {
      if (!active || !new URLSearchParams(window.location.hash.slice(1)).has('reset_token')) return;
      const value = parseResetFragment(window.location.hash);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      onRecoveryOpen();
      setResetToken(value ?? '');
      setRecovering(true);
      setOpen(true);
    };
    void Promise.resolve().then(consume);
    window.addEventListener('hashchange', consume);
    return () => {
      active = false;
      window.removeEventListener('hashchange', consume);
    };
  }, [onRecoveryOpen]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [registrationConflict, setRegistrationConflict] = useState(false);

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
    setRegistrationConflict(false);
    try {
      if (mode === 'register') {
        const result = await api.auth.register({ email, password, displayName: name });
        setMode('login');
        setMessage(
          result.verificationDelivery === 'failed'
            ? '账号已创建，验证邮件暂未发出。你可以先登录，或使用相同邮箱和密码重试注册以重发验证邮件。'
            : '注册成功，请登录。邮箱验证完成后可发送连接邀请。',
        );
      } else {
        await api.auth.loginWeb({ email, password });
        await onLogin();
      }
    } catch (error) {
      setMessage(authErrorText(error, mode));
      setRegistrationConflict(
        mode === 'register' && error instanceof ApiClientError && error.status === 409,
      );
    } finally {
      lock.current = false;
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy) return;
        setOpen(value);
        if (!value) {
          setPassword('');
          setMessage('');
          setRecovering(false);
          setResetToken('');
          onRecoveryClose();
        }
      }}
    >
      <AuthWelcome onContinue={() => setOpen(true)} />
      <DialogContent
        className="personal-app auth-theme auth-dialog translate-x-0 translate-y-0 sm:-translate-x-1/2 sm:-translate-y-1/2"
        overlayClassName="auth-dialog-overlay"
        aria-describedby={undefined}
        showCloseButton={!busy}
      >
        <DialogTitle className="sr-only">
          {recovering ? '找回密码' : mode === 'login' ? '登录 AVEN' : '注册 AVEN'}
        </DialogTitle>
        {recovering ? (
          <PasswordRecovery
            initialToken={resetToken}
            onReset={onReset}
            onBack={() => {
              setRecovering(false);
              setMode('login');
              setResetToken('');
              onRecoveryClose();
            }}
          />
        ) : (
          <AuthShell
            title={mode === 'login' ? '欢迎回来' : '创建你的 AVEN'}
            description={
              mode === 'login' ? '继续对话，遇见新的可能。' : '从一次对话，开始新的连接。'
            }
          >
            <form className="auth-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
              {mode === 'register' && (
                <div className="auth-field">
                  <Label className="sr-only" htmlFor="auth-name">
                    怎么称呼你
                  </Label>
                  <Input
                    id="auth-name"
                    placeholder="怎么称呼你"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="nickname"
                    required
                    maxLength={120}
                    disabled={busy}
                  />
                </div>
              )}
              <div className="auth-field">
                <Label className="sr-only" htmlFor="auth-email">
                  邮箱
                </Label>
                <Input
                  id="auth-email"
                  type="email"
                  inputMode="email"
                  placeholder="邮箱地址"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={320}
                  disabled={busy}
                />
              </div>
              <div className="auth-field">
                <Label className="sr-only" htmlFor="auth-password">
                  密码
                </Label>
                <AuthPassword
                  key={mode}
                  id="auth-password"
                  placeholder={mode === 'login' ? '密码' : '设置密码（至少 12 个字符）'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode === 'register' ? 12 : 1}
                  maxLength={128}
                  required
                  disabled={busy}
                  aria-describedby={mode === 'register' ? 'auth-password-hint' : undefined}
                />
              </div>
              {mode === 'register' && (
                <p id="auth-password-hint" className="auth-field-hint">
                  至少 12 个字符，建议组合字母、数字和符号。
                </p>
              )}
              {mode === 'login' && (
                <div className="auth-assistance">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPassword('');
                      onRecoveryOpen();
                      setRecovering(true);
                    }}
                  >
                    忘记密码
                  </Button>
                </div>
              )}
              {message && <Alert variant="warning">{message}</Alert>}
              {mode === 'register' && registrationConflict && (
                <div className="button-row">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMode('login');
                      setRegistrationConflict(false);
                      setMessage('');
                      setPassword('');
                    }}
                  >
                    直接登录
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPassword('');
                      onRecoveryOpen();
                      setRecovering(true);
                    }}
                  >
                    找回密码
                  </Button>
                </div>
              )}
              <Button className="auth-submit" type="submit" disabled={busy || checking}>
                {busy ? '正在验证…' : mode === 'login' ? '登录' : '创建账号'}
              </Button>
            </form>
            <div className="auth-switch">
              <span>{mode === 'login' ? '第一次来到这里？' : '已经有账号了？'}</span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setRegistrationConflict(false);
                  setPassword('');
                  setMessage('');
                }}
                aria-label={mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
              >
                {mode === 'login' ? '注册' : '登录'}
              </Button>
            </div>
            <div className="auth-connection" role="status">
              {connectionProblem ? (
                <>
                  <span>{connectionProblem}</span>
                  <Button variant="ghost" onClick={onRetry}>
                    重新连接
                  </Button>
                </>
              ) : checking ? (
                '正在安全连接…'
              ) : (
                ''
              )}
            </div>
          </AuthShell>
        )}
      </DialogContent>
    </Dialog>
  );
}
