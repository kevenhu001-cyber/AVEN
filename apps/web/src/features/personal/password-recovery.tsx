'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { api, errorText } from './api';
import { AuthShell } from './auth-shell';
import { AuthPassword } from './auth-password';

export function PasswordRecovery({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<'request' | 'reset' | 'done'>('request');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
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
            void (async () => {
              try {
                if (stage === 'request') {
                  await api.auth.requestPasswordReset(email);
                  setStage('reset');
                  setMessage('如果账号存在，已生成重置指引。请填写邮件中的重置码。');
                } else {
                  await api.auth.resetPassword(token, password);
                  setToken('');
                  setStage('done');
                  setMessage('密码已重置，所有旧会话已撤销，请重新登录。');
                }
              } catch (error) {
                setMessage(errorText(error));
              } finally {
                setPassword('');
                lock.current = false;
                setBusy(false);
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
      <p className="auth-recovery-note">开发验证版的邮件保存在本机，暂不向真实邮箱投递。</p>
      <Button className="auth-back" variant="ghost" onClick={onBack} disabled={busy}>
        返回登录
      </Button>
    </AuthShell>
  );
}
