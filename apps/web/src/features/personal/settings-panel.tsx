'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MeResponse, AuthSession } from '@aven/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';

export function SettingsPanel({
  me,
  onChanged,
  onExpired,
}: PrivateProps & {
  me: MeResponse;
  onChanged: () => void;
}) {
  const [name, setName] = useState(me.user.displayName);
  const [timezone, setTimezone] = useState(me.user.timezone);
  const [locale, setLocale] = useState(me.user.locale);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const lock = useRef(false);
  const load = useCallback(
    (signal?: AbortSignal) =>
      api.auth
        .sessions(webCall(signal))
        .then((result) => {
          if (!signal?.aborted) setSessions(result.data);
        })
        .catch((error) => {
          if (!signal?.aborted) {
            if (authExpired(error)) onExpired();
            else setMessage(errorText(error));
          }
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [onExpired],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function act(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      if (authExpired(error)) onExpired();
      else setMessage(errorText(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      await api.auth.updateProfile({ displayName: name, timezone, locale }, webCall());
      onChanged();
    });
  }
  return (
    <section className="flex flex-col gap-4" aria-label="账号设置">
      {message && <Alert variant="warning">{message}</Alert>}
      <h3>个人资料</h3>
      <form className="stack-form" onSubmit={save}>
        <Label htmlFor="settings-name">显示名</Label>
        <Input
          id="settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          disabled={busy}
        />
        <Label htmlFor="settings-timezone">时区（IANA）</Label>
        <Input
          id="settings-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          required
          maxLength={64}
          disabled={busy}
        />
        <Label htmlFor="settings-locale">语言区域</Label>
        <Input
          id="settings-locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          required
          maxLength={35}
          disabled={busy}
        />
        <Button type="submit" disabled={busy}>
          保存资料
        </Button>
      </form>
      <h3>登录设备与会话</h3>
      <Button
        variant="secondary"
        disabled={busy || loading}
        onClick={() => {
          setLoading(true);
          void load();
        }}
      >
        刷新会话
      </Button>
      {loading && <p role="status">正在读取会话…</p>}
      {sessions.map((session) => (
        <div className="memory-card flex flex-col gap-2" key={session.id}>
          <strong>
            {session.client === 'mobile' ? 'Android / 移动端' : 'Web'}
            {session.current ? ' · 当前会话' : ''}
          </strong>
          <span className="small muted">
            有效至 {new Date(session.expiresAt).toLocaleString('zh-CN')}
          </span>
          <span>{session.revokedAt ? '已撤销' : '有效'}</span>
          {!session.revokedAt && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    session.current
                      ? '撤销当前会话并退出登录？'
                      : '撤销此会话？该设备需要重新登录。',
                  )
                )
                  return;
                void act(async () => {
                  await api.auth.revokeSession(session.id, webCall());
                  if (session.current) onExpired();
                  else await load();
                });
              }}
            >
              撤销会话
            </Button>
          )}
        </div>
      ))}
      <h3>修改密码</h3>
      <p className="small muted">修改后所有设备的会话都会失效，需要重新登录。</p>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!window.confirm('修改密码并退出所有设备？')) return;
          void act(async () => {
            try {
              await api.auth.changePassword({ currentPassword, newPassword }, webCall());
              onExpired();
            } finally {
              setCurrentPassword('');
              setNewPassword('');
            }
          });
        }}
      >
        <Label htmlFor="settings-current-password">当前密码</Label>
        <Input
          id="settings-current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          maxLength={128}
          disabled={busy}
        />
        <Label htmlFor="settings-new-password">新密码（至少 12 个字符）</Label>
        <Input
          id="settings-new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={12}
          maxLength={128}
          disabled={busy}
        />
        <Button type="submit" disabled={busy}>
          修改密码并退出所有设备
        </Button>
      </form>
    </section>
  );
}
