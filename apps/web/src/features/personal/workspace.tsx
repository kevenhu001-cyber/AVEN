'use client';

import { useCallback, useState, type FormEvent } from 'react';
import type { MeResponse } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { api, errorText, type PrivateProps } from './api';
import { Chat } from './chat';
import { ConnectionsPanel } from './connections-panel';
import { Icon } from './icon';
import { Mascot } from './mascot';
import { MemoriesPanel } from './memories-panel';
import { Modal } from './modal';
import { NotificationsPanel } from './notifications-panel';
import { SettingsPanel } from './settings-panel';
import { HistoryPanel } from './history-panel';
import { SafetyPanel } from './safety-panel';

type Panel = 'memory' | 'connections' | 'notifications' | 'account' | 'history' | null;

export function Workspace({
  me,
  suspended,
  problem,
  onRetry,
  onExpired,
  onLogout,
}: PrivateProps & {
  me: MeResponse;
  suspended: boolean;
  problem: string;
  onRetry: () => void;
  onLogout: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setPanel(null), []);

  const nav = (
    <nav className="personal-nav" aria-label="个人导航">
      <Button
        variant={panel === null ? 'secondary' : 'ghost'}
        className="w-full justify-start rounded-[18px] text-foreground"
        onClick={() => {
          setPanel(null);
          setMenu(false);
        }}
      >
        对话
      </Button>
      <Button
        variant={panel === 'history' ? 'secondary' : 'ghost'}
        className="w-full justify-start"
        onClick={() => {
          setPanel('history');
          setMenu(false);
        }}
      >
        对话记录
      </Button>
      <Button
        variant={panel === 'memory' ? 'secondary' : 'ghost'}
        className="w-full justify-start rounded-[18px] text-foreground"
        onClick={() => {
          setPanel('memory');
          setMenu(false);
        }}
      >
        记忆与上下文
      </Button>
      <Button
        variant={panel === 'connections' ? 'secondary' : 'ghost'}
        className="w-full justify-start rounded-[18px] text-foreground"
        onClick={() => {
          setPanel('connections');
          setMenu(false);
        }}
      >
        我的连接
      </Button>
      <Button
        variant={panel === 'notifications' ? 'secondary' : 'ghost'}
        className="w-full justify-start rounded-[18px] text-foreground"
        onClick={() => {
          setPanel('notifications');
          setMenu(false);
        }}
      >
        通知
      </Button>
    </nav>
  );

  return (
    <main className="personal-app app-shell">
      {!suspended && (
        <aside className="personal-sidebar">
          <div className="sidebar-brand">
            <Mascot />
            <strong>AVEN</strong>
          </div>
          {nav}
          <div className="sidebar-bottom">
            <Button
              variant="ghost"
              className="profile-button h-auto w-full justify-start px-2.5 py-2 text-foreground"
              onClick={() => setPanel('account')}
            >
              <span className="name-avatar">{Array.from(me.user.displayName)[0]}</span>
              <span>
                {me.user.displayName}
                <small>个人空间</small>
              </span>
            </Button>
            <a className="small muted px-2.5" href="/diagnostics">
              工程诊断
            </a>
          </div>
        </aside>
      )}
      <div className="personal-main">
        {!suspended && (
          <header className="personal-header">
            <Button
              variant="outline"
              size="icon"
              className="mobile-nav-button border-border bg-card text-foreground"
              aria-label="打开导航"
              onClick={() => setMenu(true)}
            >
              <Icon name="menu" />
            </Button>
            <div className="assistant-identity">
              <Mascot />
              <span>AVEN</span>
            </div>
            <Badge variant="outline" className="release-label rounded-full font-normal">
              Web 开发验证版
            </Badge>
            <Button
              variant="outline"
              size="icon"
              className="border-border bg-card text-foreground"
              aria-label="我的账号"
              onClick={() => setPanel('account')}
            >
              <Icon name="ellipsis" />
            </Button>
          </header>
        )}
        {suspended && (
          <section className="session-cover flex flex-col items-center gap-4" aria-label="会话校验">
            <Mascot large state="thinking" />
            <h1>先确认一下当前会话</h1>
            <p role="status">{problem || '正在重新验证，私人内容暂时隐藏。'}</p>
            <Button onClick={onRetry}>重新验证会话</Button>
          </section>
        )}
        <Chat suspended={suspended} onExpired={onExpired} />
      </div>
      {!suspended && menu && (
        <Modal title="AVEN" onClose={() => setMenu(false)}>
          <div className="flex flex-col gap-3">
            {nav}
            <Separator />
            <Button
              variant="ghost"
              className="profile-button h-auto w-full justify-start text-foreground"
              onClick={() => {
                setPanel('account');
                setMenu(false);
              }}
            >
              {me.user.displayName}
            </Button>
          </div>
        </Modal>
      )}
      {!suspended && panel && (
        <Modal
          title={
            {
              memory: '记忆与上下文',
              connections: '我的连接',
              notifications: '通知',
              account: '我的账号',
              history: '对话记录',
            }[panel]
          }
          onClose={close}
        >
          {panel === 'memory' && <MemoriesPanel onExpired={onExpired} />}
          {panel === 'connections' && (
            <ConnectionsPanel userId={me.user.id} onExpired={onExpired} />
          )}
          {panel === 'notifications' && (
            <NotificationsPanel
              onExpired={onExpired}
              onConnections={() => setPanel('connections')}
            />
          )}
          {panel === 'history' && <HistoryPanel onExpired={onExpired} />}
          {panel === 'account' && (
            <>
              <Account me={me} onRetry={onRetry} onLogout={onLogout} />
              <SettingsPanel me={me} onChanged={onRetry} onExpired={onExpired} />
              <SafetyPanel onExpired={onExpired} />
            </>
          )}
        </Modal>
      )}
    </main>
  );
}

function Account({
  me,
  onRetry,
  onLogout,
}: {
  me: MeResponse;
  onRetry: () => void;
  onLogout: () => void;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.auth.verifyEmail(token);
      setToken('');
      onRetry();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="m-0">{me.user.displayName}</h3>
          <p className="wrap m-0 text-sm text-muted-foreground">{me.user.email}</p>
        </div>
        <Badge variant={me.user.emailVerified ? 'success' : 'warning'}>
          {me.user.emailVerified ? '邮箱已验证' : '邮箱尚未验证'}
        </Badge>
      </div>
      {!me.user.emailVerified && (
        <form className="stack-form" onSubmit={(event) => void verify(event)}>
          <p className="small muted m-0">连接邀请等操作需要验证邮箱。请使用验证邮件中的验证码。</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verify-email-token">邮箱验证码</Label>
            <Input
              id="verify-email-token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              minLength={20}
              maxLength={256}
              required
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? '正在验证…' : '验证邮箱'}
          </Button>
        </form>
      )}
      {error && <Alert variant="warning">{error}</Alert>}
      <Separator />
      <p className="small muted m-0">
        AI 当前为
        Mock；真实邮箱、外部插件与模型尚未接通。对话记录按服务端保留期读取；通知需手动刷新。
      </p>
      <div>
        <Button variant="secondary" onClick={onLogout}>
          退出登录
        </Button>
      </div>
    </section>
  );
}
