'use client';
import { Icon } from './icon';
import { useCallback, useState, type FormEvent } from 'react';
import type { MeResponse } from '@aven/contracts';
import { api, errorText, type PrivateProps } from './api';
import { Mascot } from './mascot';
import { Chat } from './chat';
import { Modal } from './modal';
import { MemoriesPanel } from './memories-panel';
import { ConnectionsPanel } from './connections-panel';
import { NotificationsPanel } from './notifications-panel';
type Panel = 'memory' | 'connections' | 'notifications' | 'account' | null;
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
      <button
        onClick={() => {
          setPanel(null);
          setMenu(false);
        }}
      >
        对话
      </button>
      <button
        onClick={() => {
          setPanel('memory');
          setMenu(false);
        }}
      >
        记忆与上下文
      </button>
      <button
        onClick={() => {
          setPanel('connections');
          setMenu(false);
        }}
      >
        我的连接
      </button>
      <button
        onClick={() => {
          setPanel('notifications');
          setMenu(false);
        }}
      >
        通知
      </button>
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
            <button className="profile-button" onClick={() => setPanel('account')}>
              <span className="name-avatar">{Array.from(me.user.displayName)[0]}</span>
              <span>
                {me.user.displayName}
                <small>个人空间</small>
              </span>
            </button>
            <a className="small muted" href="/diagnostics">
              工程诊断
            </a>
          </div>
        </aside>
      )}
      <div className="personal-main">
        {!suspended && (
          <header className="personal-header">
            <button
              className="icon-button mobile-nav-button"
              aria-label="打开导航"
              onClick={() => setMenu(true)}
            >
              <Icon name="menu" />
            </button>
            <div className="assistant-identity">
              <Mascot />
              <span>AVEN</span>
            </div>
            <span className="release-label">Web 开发验证版</span>
            <button
              className="icon-button"
              aria-label="我的账号"
              onClick={() => setPanel('account')}
            >
              <Icon name="ellipsis" />
            </button>
          </header>
        )}
        {suspended && (
          <section className="session-cover" aria-label="会话校验">
            <Mascot large state="thinking" />
            <h1>先确认一下当前会话</h1>
            <p role="status">{problem || '正在重新验证，私人内容暂时隐藏。'}</p>
            <button onClick={onRetry}>重新验证会话</button>
          </section>
        )}
        <Chat suspended={suspended} onExpired={onExpired} />
      </div>
      {!suspended && menu && (
        <Modal title="AVEN" onClose={() => setMenu(false)}>
          {nav}
          <button
            className="profile-button"
            onClick={() => {
              setPanel('account');
              setMenu(false);
            }}
          >
            {me.user.displayName}
          </button>
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
          {panel === 'account' && <Account me={me} onRetry={onRetry} onLogout={onLogout} />}
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
    <section>
      <h3>{me.user.displayName}</h3>
      <p className="wrap">{me.user.email}</p>
      <p>{me.user.emailVerified ? '邮箱已验证' : '邮箱尚未验证'}</p>
      {!me.user.emailVerified && (
        <form className="stack-form" onSubmit={(event) => void verify(event)}>
          <p className="small muted">连接邀请等操作需要验证邮箱。请使用验证邮件中的验证码。</p>
          <label>
            邮箱验证码
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              minLength={20}
              maxLength={256}
              required
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? '正在验证…' : '验证邮箱'}
          </button>
        </form>
      )}
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      <p className="small muted">
        AI 当前为
        Mock；真实邮箱、外部插件与模型尚未接通。历史对话列表、自动通知刷新和原生端将在后续接入。
      </p>
      <button className="secondary" onClick={onLogout}>
        退出登录
      </button>
    </section>
  );
}
