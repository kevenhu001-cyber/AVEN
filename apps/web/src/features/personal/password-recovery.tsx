'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { api, errorText } from './api';
import { AuthShell } from './auth-shell';
import { AuthPassword } from './auth-password';

export function PasswordRecovery({
  onBack,
  initialToken = '',
  onReset,
}: {
  onBack: () => void;
  initialToken?: string;
  onReset: () => void;
}) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<'request' | 'reset' | 'done'>(
    initialToken ? 'reset' : 'request',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  return (
    <AuthShell
      title={stage === 'done' ? '密码已重置' : '找回密码'}
      description="重新开启与你的对话。"
    >
      {message && <Alert variant="warning">{message}</Alert>}
      {stage !== 'done' && (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setMessage('');
            const controller = new AbortController();
            request.current = controller;
            void (async () => {
              try {
                if (stage === 'request') {
                  await api.auth.requestPasswordReset(email, controller.signal);
                  if (controller.signal.aborted) return;
                  setStage('reset');
                  setMessage('如果账号存在，已生成重置指引。请打开邮件中的链接，或填写重置码。');
                } else {
                  await api.auth.resetPassword(token, password, controller.signal);
                  if (controller.signal.aborted) return;
                  onReset();
                  setToken('');
                  setStage('done');
                  setMessage('密码已重置，所有旧会话已撤销，请重新登录。');
                }
              } catch (error) {
                if (!controller.signal.aborted) setMessage(errorText(error));
              } finally {
                lock.current = false;
                if (!controller.signal.aborted) {
                  setPassword('');
                  setBusy(false);
                }
              }
            })();
          }}
        >
          {stage === 'request' ? (
            <>
              <Label className="sr-only" htmlFor="reset-email">
                账号邮箱
              </Label>
              <Input
                id="reset-email"
                placeholder="账号邮箱"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                autoComplete="username"
              />
            </>
          ) : (
            <>
              <Label className="sr-only" htmlFor="reset-token">
                重置码
              </Label>
              <Input
                id="reset-token"
                placeholder="邮件中的重置码"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                minLength={20}
                maxLength={256}
                disabled={busy}
                autoComplete="off"
              />
              <Label className="sr-only" htmlFor="reset-password">
                新密码
              </Label>
              <AuthPassword
                id="reset-password"
                placeholder="新密码（至少 12 个字符）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                maxLength={128}
                disabled={busy}
                autoComplete="new-password"
              />
            </>
          )}
          <Button className="auth-submit" type="submit" disabled={busy}>
            {busy ? '正在处理…' : stage === 'request' ? '获取重置指引' : '重置密码'}
          </Button>
        </form>
      )}
      <p className="auth-recovery-note">重置链接一小时内有效。请留意收件箱与垃圾邮件。</p>
      <Button className="auth-back" variant="ghost" onClick={onBack} disabled={busy}>
        返回登录
      </Button>
    </AuthShell>
  );
}
