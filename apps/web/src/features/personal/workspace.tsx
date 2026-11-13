'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { MeResponse, PluginManifest } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';
import { Chat } from './chat';
import { ConnectionsPanel } from './connections-panel';
import { Icon } from './icon';
import { Mascot, type MascotState } from './mascot';
import { MemoriesPanel } from './memories-panel';
import { NotificationsPanel } from './notifications-panel';
import { ActionForm, ConnectAppsList } from './plugins/connector-dialog';
import { authTransition, detectConnectorIntent, type AuthState } from './halo/catalog';
import { HomeScreen } from './halo/home';
import {
  currentScreen,
  initialStack,
  popScreen,
  pushScreen,
  screenPosition,
  type HaloScreen,
} from './halo/navigation';
import { Sheet, useToast } from './halo/primitives';
import { ProfileScreen } from './halo/profile';
import { templateFromConversation } from './halo/text';
import type { AuthBook, CatalogState, ChatExtra, ConnectorResult } from './halo/types';
import { useAgentChat } from './use-agent-chat';

const BOT_NAME = 'AVEN';
const INTENT_HINT = /(连接|连上|接入|授权|绑定|添加|connect|authorize)/i;

type Panel =
  | { kind: 'memory' | 'connections' | 'notifications' | 'account' }
  | { kind: 'placeholder'; title: string; body: string }
  | { kind: 'action'; plugin: PluginManifest; actionName: string };

const panelTitles = {
  memory: '资料库 · 记忆与上下文',
  connections: '我的连接',
  notifications: '通知',
  account: '我的账号',
};

function useCatalog(onExpired: () => void): CatalogState {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<Promise<PluginManifest[]> | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = useCallback(() => {
    if (pending.current) return pending.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError('');
    const request = api.plugins
      .listCatalog(webCall(abort.signal))
      .then((result) => {
        setPlugins(result.plugins);
        setLoaded(true);
        return result.plugins;
      })
      .catch((cause) => {
        if (abort.signal.aborted) return [];
        if (authExpired(cause)) onExpired();
        else setError(errorText(cause));
        return [];
      })
      .finally(() => {
        pending.current = null;
        if (!abort.signal.aborted) setLoading(false);
      });
    pending.current = request;
    return request;
  }, [onExpired]);
  return { plugins, loading, loaded, error, load };
}

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
  const chat = useAgentChat(suspended, onExpired);
  const catalog = useCatalog(onExpired);
  const [stack, setStack] = useState(initialStack);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lastPanel, setLastPanel] = useState<Panel | null>(null);
  const [appsOpen, setAppsOpen] = useState(false);
  const [appsQuery, setAppsQuery] = useState('');
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [extras, setExtras] = useState<ChatExtra[]>([]);
  const [authStates, setAuthStates] = useState<Record<string, AuthState>>({});
  const [celebrate, setCelebrate] = useState(false);
  const [searchRequest, setSearchRequest] = useState<{ query: string; seq: number } | null>(null);
  const timers = useRef<number[]>([]);
  const [toast, showToast] = useToast();
  const screen = currentScreen(stack);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const go = useCallback((next: HaloScreen) => setStack((state) => pushScreen(state, next)), []);
  const back = useCallback(() => setStack((state) => popScreen(state)), []);
  const open = useCallback((next: Panel) => {
    setPanel(next);
    setLastPanel(next);
  }, []);

  const connected = useMemo(
    () =>
      new Set(
        Object.entries(authStates)
          .filter(([, state]) => state === 'connected')
          .map(([id]) => id),
      ),
    [authStates],
  );

  const auth: AuthBook = {
    states: authStates,
    connected,
    dispatch: (pluginId, event) => {
      setAuthStates((states) => ({
        ...states,
        [pluginId]: authTransition(states[pluginId] ?? 'idle', event),
      }));
      if (event === 'confirm')
        later(() => {
          setAuthStates((states) => ({
            ...states,
            [pluginId]: authTransition(states[pluginId] ?? 'idle', 'settled'),
          }));
          setCelebrate(true);
          later(() => setCelebrate(false), 2200);
        }, 950);
    },
  };

  function addAuthCard(plugin: PluginManifest, source: 'sheet' | 'intent') {
    setExtras((items) =>
      items.some(
        (item) =>
          item.kind === 'auth' &&
          item.pluginId === plugin.id &&
          (authStates[plugin.id] ?? 'idle') !== 'connected',
      )
        ? items
        : [
            ...items,
            {
              kind: 'auth',
              key: `auth-${plugin.id}-${Date.now()}`,
              pluginId: plugin.id,
              createdAt: Date.now(),
              source,
            },
          ],
    );
  }

  const send = () => {
    const text = chat.draft.trim();
    const accepted = Boolean(text) && text.length <= 8000 && !chat.busy && !suspended;
    chat.send();
    if (!accepted || !INTENT_HINT.test(text)) return;
    void (catalog.loaded ? Promise.resolve(catalog.plugins) : catalog.load()).then((plugins) => {
      const plugin = detectConnectorIntent(text, plugins);
      if (plugin) addAuthCard(plugin, 'intent');
    });
  };

  function newChat() {
    if (chat.busy) {
      showToast('当前回复还在进行，请先停止或等待完成。');
      return;
    }
    chat.reset();
    setExtras([]);
    go('chat');
  }

  function openApps() {
    setAppsOpen(true);
    if (!catalog.loaded) void catalog.load();
  }

  function addResult(result: ConnectorResult) {
    setExtras((items) => [...items, { kind: 'result', createdAt: Date.now(), ...result }]);
    setAppsOpen(false);
    setPanel(null);
    go('chat');
  }

  async function shareTemplate() {
    const text = templateFromConversation(
      BOT_NAME,
      chat.turns.map((turn) => turn.input),
    );
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制对话模板（仅你的提问，未公开分享）。');
    } catch {
      open({ kind: 'placeholder', title: '分享为模板', body: text });
    }
  }

  const mascotState: MascotState = celebrate
    ? 'happy'
    : chat.turns.some((turn) =>
          ['sending', 'queued', 'running', 'cancelling'].includes(turn.status),
        )
      ? 'thinking'
      : 'idle';

  const shown = panel ?? lastPanel;
  const screenProps = (name: HaloScreen) => {
    const position = screenPosition(stack, name);
    return {
      className: 'halo-screen',
      'data-screen': name,
      'data-position': position,
      'data-direction': stack.direction,
      inert: position !== 'active',
      'aria-hidden': position !== 'active',
    } as const;
  };

  let panelBody: ReactNode = null;
  let panelTitle = '';
  if (shown?.kind === 'memory') panelBody = <MemoriesPanel onExpired={onExpired} />;
  if (shown?.kind === 'connections')
    panelBody = <ConnectionsPanel userId={me.user.id} onExpired={onExpired} />;
  if (shown?.kind === 'notifications')
    panelBody = (
      <NotificationsPanel
        onExpired={onExpired}
        onConnections={() => open({ kind: 'connections' })}
      />
    );
  if (shown?.kind === 'account')
    panelBody = (
      <Account me={me} onRetry={onRetry} onLogout={onLogout} onOpen={(kind) => open({ kind })} />
    );
  if (shown && shown.kind !== 'placeholder' && shown.kind !== 'action')
    panelTitle = panelTitles[shown.kind];
  if (shown?.kind === 'placeholder') {
    panelTitle = shown.title;
    panelBody = (
      <div className="halo-placeholder">
        <Mascot size={64} state="curious" />
        <p className="halo-placeholder-body">{shown.body}</p>
        <Badge variant="outline">尚未开放</Badge>
      </div>
    );
  }
  if (shown?.kind === 'action') {
    const action = shown.plugin.actions.find((item) => item.name === shown.actionName);
    panelTitle = `${shown.plugin.name} · 动作`;
    panelBody = action ? (
      <ActionForm
        plugin={shown.plugin}
        action={action}
        onClose={() => setPanel(null)}
        onResult={addResult}
        onExpired={onExpired}
      />
    ) : null;
  }

  const appsPlugins = onlyConnected
    ? catalog.plugins.filter((plugin) => connected.has(plugin.id))
    : catalog.plugins;

  return (
    <main className="personal-app aven-theme-halo halo-app">
      <div className="halo-shell">
        {suspended && (
          <section className="session-cover halo-cover" aria-label="会话校验">
            <Mascot size={96} state="thinking" />
            <h1>先确认一下当前会话</h1>
            <p role="status">{problem || '正在重新验证，私人内容暂时隐藏。'}</p>
            <Button onClick={onRetry}>重新验证会话</Button>
          </section>
        )}
        <div className="halo-stage" hidden={suspended}>
          <div {...screenProps('home')}>
            {!suspended && (
              <HomeScreen
                displayName={me.user.displayName}
                botName={BOT_NAME}
                mascotState={mascotState}
                busy={chat.busy}
                onAccount={() => open({ kind: 'account' })}
                onNewChat={newChat}
                onOpenChat={() => go('chat')}
                onOpenProfile={() => go('profile')}
                onOpenApps={openApps}
                onSearch={(query) => {
                  setSearchRequest((current) => ({ query, seq: (current?.seq ?? 0) + 1 }));
                  go('chat');
                }}
              />
            )}
          </div>
          <div {...screenProps('profile')}>
            {!suspended && (
              <ProfileScreen
                botName={BOT_NAME}
                active={screen === 'profile'}
                mascotState={mascotState}
                connectedCount={connected.size}
                onBack={back}
                onLibrary={() => open({ kind: 'memory' })}
                onConnections={() => open({ kind: 'connections' })}
                onNotifications={() => open({ kind: 'notifications' })}
                onApps={openApps}
                onAccount={() => open({ kind: 'account' })}
                onNewChat={newChat}
                onPlaceholder={(title, body) => open({ kind: 'placeholder', title, body })}
                onExpired={onExpired}
              />
            )}
          </div>
          <div {...screenProps('chat')}>
            <Chat
              chat={{ ...chat, send }}
              suspended={suspended}
              active={screen === 'chat'}
              botName={BOT_NAME}
              extras={extras}
              plugins={catalog.plugins}
              auth={auth}
              celebrate={celebrate}
              searchRequest={searchRequest}
              onBack={back}
              onOpenProfile={() => go('profile')}
              onOpenApps={openApps}
              onNewChat={newChat}
              onShareTemplate={() => void shareTemplate()}
              onRunAction={(plugin, actionName) => open({ kind: 'action', plugin, actionName })}
              onUnavailable={showToast}
            />
          </div>
        </div>
        {toast}
      </div>
      {!suspended && (
        <>
          <Sheet open={panel !== null} onClose={() => setPanel(null)} title={panelTitle}>
            {panelBody}
          </Sheet>
          <Sheet
            open={appsOpen}
            onClose={() => setAppsOpen(false)}
            title="连接应用"
            variant="full"
            headerExtra={
              <button
                type="button"
                className="halo-pill halo-pill-neutral halo-pill-lg halo-press"
                aria-pressed={onlyConnected}
                onClick={() => setOnlyConnected((value) => !value)}
              >
                已连接 {connected.size} 个
                <Icon name="chevron" size={18} />
              </button>
            }
            footer={
              <label className="halo-search">
                <Icon name="search" size={22} />
                <span className="sr-only">搜索应用和技能</span>
                <input
                  value={appsQuery}
                  onChange={(event) => setAppsQuery(event.target.value)}
                  placeholder="搜索应用和技能"
                />
              </label>
            }
          >
            {onlyConnected && !connected.size ? (
              <p className="halo-empty">
                本页还没有模拟连接的应用。点「已连接 0 个」返回全部应用。
              </p>
            ) : (
              <ConnectAppsList
                catalog={{ ...catalog, plugins: appsPlugins }}
                connected={connected}
                query={appsQuery}
                onExpired={onExpired}
                onResult={addResult}
                onConnect={(plugin) => {
                  setAppsOpen(false);
                  addAuthCard(plugin, 'sheet');
                  go('chat');
                }}
              />
            )}
          </Sheet>
        </>
      )}
    </main>
  );
}

function Account({
  me,
  onRetry,
  onLogout,
  onOpen,
}: {
  me: MeResponse;
  onRetry: () => void;
  onLogout: () => void;
  onOpen: (kind: 'memory' | 'connections' | 'notifications') => void;
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
      <div className="halo-account-head">
        <span className="halo-avatar halo-avatar-lg" aria-hidden="true">
          {Array.from(me.user.displayName)[0]}
        </span>
        <div className="min-w-0">
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
      <nav className="halo-group" aria-label="个人导航">
        <button type="button" className="halo-row halo-press-soft" onClick={() => onOpen('memory')}>
          <Icon name="library" size={22} className="halo-row-icon" />
          <span className="halo-row-label">记忆与上下文</span>
          <Icon name="chevron" size={20} className="halo-row-chevron" />
        </button>
        <button
          type="button"
          className="halo-row halo-press-soft"
          onClick={() => onOpen('connections')}
        >
          <Icon name="link" size={22} className="halo-row-icon" />
          <span className="halo-row-label">我的连接</span>
          <Icon name="chevron" size={20} className="halo-row-chevron" />
        </button>
        <button
          type="button"
          className="halo-row halo-press-soft"
          onClick={() => onOpen('notifications')}
        >
          <Icon name="bell" size={22} className="halo-row-icon" />
          <span className="halo-row-label">通知</span>
          <Icon name="chevron" size={20} className="halo-row-chevron" />
        </button>
        <a className="halo-row halo-press-soft" href="/diagnostics">
          <Icon name="wrench" size={22} className="halo-row-icon" />
          <span className="halo-row-label">工程诊断</span>
          <Icon name="chevron" size={20} className="halo-row-chevron" />
        </a>
      </nav>
      <p className="small muted m-0">
        AI 当前为
        Mock；真实邮箱、外部插件与模型尚未接通。历史对话列表、自动通知刷新和原生端将在后续接入。
      </p>
      <div>
        <Button variant="secondary" onClick={onLogout}>
          <Icon name="logout" size={18} />
          退出登录
        </Button>
      </div>
    </section>
  );
}
