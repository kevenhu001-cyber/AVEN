'use client';

import { useState, useRef, type FormEvent } from 'react';
import { useAgentRuntime } from './use-agent-runtime';
import type { AgentRuntime, MeResponse } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { api, errorText, type PrivateProps } from './api';
import { Chat, type ChatHandle } from './chat';
import { ConnectionsPanel } from './connections-panel';
import { Icon, type IconName } from './icon';
import { workspacePages, primaryPage, type WorkspacePage } from './workspace-navigation';
import { Mascot } from './mascot';
import { MemoriesPanel } from './memories-panel';
import { Modal } from './modal';
import { NotificationsPanel } from './notifications-panel';
import { SettingsPanel } from './settings-panel';
import { HistoryPanel } from './history-panel';
import { SafetyPanel } from './safety-panel';

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
  const model = useAgentRuntime(suspended, onExpired);
  const [page, setPage] = useState<WorkspacePage>('chat');
  const [menu, setMenu] = useState(false);
  const chatControls = useRef<ChatHandle>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const title = {
    chat: '对话',
    memory: '记忆与上下文',
    connections: '我的连接',
    notifications: '通知',
    more: '你的空间',
    history: '对话记录',
    account: '账号与设置',
  }[page];
  const navigate = (next: WorkspacePage) => {
    setPage(next);
    setMenu(false);
  };
  const newChat = () => {
    if (chatBusy) return;
    chatControls.current?.reset();
    navigate('chat');
  };
  const openConnectors = () => {
    chatControls.current?.openConnectors();
    navigate('chat');
  };
  const nav = (
    <nav className="personal-nav" aria-label="个人导航">
      {workspacePages.map((item) => (
        <Button
          key={item.id}
          variant="ghost"
          className="workspace-nav-item"
          aria-label={
            item.id === 'memory'
              ? '记忆与上下文'
              : item.id === 'connections'
                ? '我的连接'
                : item.label
          }
          aria-current={primaryPage(page) === item.id ? 'page' : undefined}
          onClick={() => navigate(item.id)}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Button>
      ))}
      <Button variant="ghost" className="workspace-nav-item" onClick={() => navigate('history')}>
        <Icon name="history" />
        <span>对话记录</span>
      </Button>
      <Button variant="ghost" className="workspace-nav-item" onClick={openConnectors}>
        <Icon name="plug" />
        <span>连接器</span>
      </Button>
    </nav>
  );
  return (
    <main className={`personal-app app-shell workspace-theme${suspended ? ' is-suspended' : ''}`}>
      {!suspended && (
        <aside className="personal-sidebar">
          <div className="sidebar-brand">
            <Mascot state="static" />
            <strong>AVEN</strong>
          </div>
          <Button
            variant="secondary"
            className="new-chat-button"
            onClick={newChat}
            disabled={chatBusy}
          >
            <Icon name="compose" />
            新对话
          </Button>
          {nav}
          <div className="sidebar-bottom">
            <Button
              variant="ghost"
              className="profile-button"
              aria-label="我的账号"
              onClick={() => navigate('account')}
            >
              <span className="name-avatar">{Array.from(me.user.displayName)[0]}</span>
              <span className="profile-name">
                {me.user.displayName}
                <small>账号与设置</small>
              </span>
              <Icon name="settings" />
            </Button>
          </div>
        </aside>
      )}
      <div className="personal-main">
        {!suspended && (
          <header className="personal-header">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-nav-button header-circle"
              aria-label="打开导航"
              onClick={() => setMenu(true)}
            >
              <Icon name="menu" />
            </Button>
            <div className="assistant-identity">
              <Mascot state="static" />
              <span>
                AVEN
                <small>
                  {model.runtime?.providerMode === 'live'
                    ? '真实模型'
                    : model.runtime
                      ? '模拟模式'
                      : '正在确认模型'}
                </small>
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="header-circle new-chat-icon"
              aria-label="开始新对话"
              title="新对话"
              onClick={newChat}
              disabled={chatBusy}
            >
              <Icon name="compose" />
            </Button>
          </header>
        )}
        {suspended && (
          <section className="session-cover flex flex-col items-center gap-4" aria-label="会话校验">
            <Mascot large state="static" />
            <h1>先确认一下当前会话</h1>
            <p role="status">{problem || '正在重新验证，私人内容暂时隐藏。'}</p>
            <Button onClick={onRetry}>重新验证会话</Button>
          </section>
        )}
        {model.error && !suspended && (
          <Alert variant="warning">
            暂时无法确认模型状态。
            <Button variant="ghost" onClick={model.retry}>
              重新读取模型状态
            </Button>
          </Alert>
        )}
        <div className="workspace-chat-host" hidden={page !== 'chat' || suspended}>
          <Chat
            suspended={suspended}
            runtime={model.runtime}
            visible={page === 'chat'}
            ref={chatControls}
            onBusyChange={setChatBusy}
            onExpired={onExpired}
          />
        </div>
        {!suspended && page !== 'chat' && (
          <section className="workspace-page" aria-label={title} key={page}>
            <div className="workspace-page-inner">
              <header className="workspace-page-heading">
                <h1>{title}</h1>
                {page !== 'more' && (
                  <Button variant="ghost" onClick={() => navigate('chat')}>
                    回到对话
                    <Icon name="arrow-right" />
                  </Button>
                )}
              </header>
              {page === 'memory' && <MemoriesPanel onExpired={onExpired} />}
              {page === 'connections' && (
                <ConnectionsPanel userId={me.user.id} onExpired={onExpired} />
              )}
              {page === 'notifications' && (
                <NotificationsPanel
                  onExpired={onExpired}
                  onConnections={() => navigate('connections')}
                />
              )}
              {page === 'history' && <HistoryPanel onExpired={onExpired} />}
              {page === 'account' && (
                <>
                  <Account me={me} runtime={model.runtime} onRetry={onRetry} onLogout={onLogout} />
                  <SettingsPanel me={me} onChanged={onRetry} onExpired={onExpired} />
                  <SafetyPanel onExpired={onExpired} />
                </>
              )}
              {page === 'more' && (
                <>
                  <p className="space-description">把想法、连接和进展放在一起。</p>
                  <div className="space-menu">
                    <SpaceRow
                      icon="history"
                      title="对话记录"
                      description="重新查看保留期内的回复"
                      onClick={() => navigate('history')}
                    />
                    <SpaceRow
                      icon="plug"
                      title="连接器"
                      description="探索工具与模拟体验"
                      onClick={openConnectors}
                    />
                    <SpaceRow
                      icon="layers"
                      title="记忆与上下文"
                      description="管理你确认的信息与使用范围"
                      onClick={() => navigate('memory')}
                    />
                    <SpaceRow
                      icon="settings"
                      title="账号与安全"
                      description="个人资料、设备会话与密码"
                      onClick={() => navigate('account')}
                    />
                  </div>
                  <p className="space-footnote">
                    {model.runtime?.providerMode === 'live'
                      ? 'AI 使用真实模型；连接器仍为模拟体验。'
                      : '当前为 Mock 演示，外部服务尚未接通。'}
                  </p>
                </>
              )}
            </div>
          </section>
        )}
        {!suspended && (
          <nav className="mobile-bottom-nav" aria-label="底部导航">
            {workspacePages.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                aria-current={primaryPage(page) === item.id ? 'page' : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Button>
            ))}
          </nav>
        )}
      </div>
      {!suspended && menu && (
        <Modal title="AVEN" onClose={() => setMenu(false)}>
          <Button
            variant="secondary"
            className="new-chat-button"
            onClick={newChat}
            disabled={chatBusy}
          >
            <Icon name="compose" />
            新对话
          </Button>
          {nav}
          <Separator />
          <Button
            variant="ghost"
            className="profile-button"
            aria-label="我的账号"
            onClick={() => navigate('account')}
          >
            <Icon name="settings" />
            {me.user.displayName}
          </Button>
        </Modal>
      )}
    </main>
  );
}

function SpaceRow({
  icon,
  title,
  description,
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" className="space-menu-row" onClick={onClick}>
      <Icon name={icon} />
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <Icon name="arrow-right" />
    </Button>
  );
}

function Account({
  me,
  runtime,
  onRetry,
  onLogout,
}: {
  me: MeResponse;
  runtime: AgentRuntime | null;
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
        {runtime?.providerMode === 'live'
          ? 'AI 使用真实模型，发送当前提问及本次获准上下文。'
          : runtime
            ? 'AI 当前为 Mock。'
            : '正在确认模型状态。'}
        外部连接器仍为模拟；账号验证与密码恢复使用邮件。对话记录按服务端保留期读取；通知需手动刷新。
      </p>
      <div>
        <Button variant="secondary" onClick={onLogout}>
          退出登录
        </Button>
      </div>
    </section>
  );
}
