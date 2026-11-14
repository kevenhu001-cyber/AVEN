'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { MeResponse } from '@aven/contracts';
import { useChat } from '@/features/personal/app-state';
import { AppsCatalog } from '@/features/personal/apps-catalog';
import { BotInfoDrawer } from '@/features/personal/halo/bot-info-drawer';
import { Mascot } from '@/features/personal/mascot';
import { Icon, type IconName } from '@/features/personal/icon';
import { useProviderStatus } from '@/features/personal/use-provider-status';
import {
  ShellAppsContext,
  ShellNavigationContext,
  ShellProfileContext,
} from './navigation-context';
import './shell.css';

const SIDEBAR_KEY = 'aven.shell.sidebar';
const SIDEBAR_QUERY = '(max-width: 1080px)';
const sidebarListeners = new Set<() => void>();

function readSidebarCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_KEY);
    if (stored === 'collapsed') return true;
    if (stored === 'expanded') return false;
  } catch {
    // Storage can be unavailable in private modes; fall back to the viewport.
  }
  return true;
}

function subscribeSidebar(listener: () => void) {
  sidebarListeners.add(listener);
  const media = window.matchMedia(SIDEBAR_QUERY);
  media.addEventListener('change', listener);
  window.addEventListener('storage', listener);
  return () => {
    sidebarListeners.delete(listener);
    media.removeEventListener('change', listener);
    window.removeEventListener('storage', listener);
  };
}

function writeSidebarCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
  } catch {
    // Ignore; listeners still re-render with the viewport default.
  }
  for (const listener of sidebarListeners) listener();
}

type NavItem = { href: string; label: string; icon: IconName; activeOn?: string[] };
type NavSection = { id: string; label: string; items: NavItem[] };

const personalPrimaryNav: NavItem[] = [
  { href: '/', label: '对话', icon: 'chat', activeOn: ['/chat'] },
  { href: '/connections', label: '我的连接', icon: 'link' },
];

const personalSecondaryNav: NavItem[] = [
  { href: '/apps', label: '连接应用', icon: 'apps' },
  { href: '/memory', label: '记忆与上下文', icon: 'library' },
  { href: '/notifications', label: '通知', icon: 'bell' },
  { href: '/profile', label: 'Bot 资料', icon: 'profile' },
];

const personalMobileNav: NavItem[] = [
  { href: '/', label: '对话', icon: 'chat', activeOn: ['/chat'] },
  { href: '/connections', label: '连接', icon: 'link' },
  { href: '/apps', label: '应用', icon: 'apps' },
];

const personalMorePaths = ['/profile', '/memory', '/notifications', '/account'];
const appsNavItem = personalSecondaryNav[0]!;
const desktopPersonalSections: NavSection[] = [
  {
    id: 'space',
    label: '我的空间',
    items: [...personalPrimaryNav.slice(1), ...personalSecondaryNav.slice(1)],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (item.activeOn?.includes(pathname)) return true;
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({
  item,
  pathname,
  onNavigate,
  onOpenApps,
  onOpenProfile,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: (() => void) | undefined;
  onOpenApps?: (() => void) | undefined;
  onOpenProfile?: (() => void) | undefined;
}) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      className={`shell-nav-link${item.href === '/apps' ? ' shell-nav-link-apps' : ''}`}
      aria-label={item.label}
      title={item.label}
      aria-haspopup={onOpenApps && item.href === '/apps' ? 'dialog' : undefined}
      aria-current={active ? 'page' : undefined}
      onNavigate={(event) => {
        if (item.href === '/apps' && onOpenApps) {
          event.preventDefault();
          onOpenApps();
        } else if (item.href === '/profile' && onOpenProfile) {
          event.preventDefault();
          onOpenProfile();
        } else {
          onNavigate?.();
        }
      }}
    >
      <Icon name={item.icon} size={20} />
      <span className="shell-nav-label">{item.label}</span>
    </Link>
  );
}

function SidebarBotButton({ onOpenProfile }: { onOpenProfile: () => void }) {
  const chat = useChat();
  return (
    <button
      type="button"
      className="shell-chat-bot"
      aria-label="查看 AVEN 资料"
      title="AVEN"
      onClick={onOpenProfile}
    >
      <Mascot size={48} state={chat.busy ? 'thinking' : 'idle'} badge />
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="halo-avatar" aria-hidden="true">
      {Array.from(name)[0] ?? '我'}
    </span>
  );
}

/**
 * New conversation from anywhere in the personal app. Navigating to `/chat`
 * keeps the chat screen mounted; resetting the shared state makes it empty.
 */
function NewChatButton({ onNavigate, current }: { onNavigate?: () => void; current?: boolean }) {
  const chat = useChat();
  const router = useRouter();
  return (
    <button
      type="button"
      className="shell-new-chat"
      aria-label="开启新对话"
      title="新对话"
      data-current={current || undefined}
      disabled={chat.busy}
      onClick={() => {
        chat.newChat();
        onNavigate?.();
        router.push('/chat');
      }}
    >
      <Icon name="new-chat" size={18} />
      <span className="shell-new-chat-label">新对话</span>
    </button>
  );
}

/**
 * Stored conversation feed for the personal sidebar and drawer. Titles come from the
 * first user message server-side; selecting one restores the durable messages feed.
 * Only rendered inside the personal variant, where AppStateProvider supplies the chat.
 */
function RecentConversations({ onNavigate }: { onNavigate?: () => void }) {
  const chat = useChat();
  if (chat.conversationsStatus === 'idle') return null;
  const activeId = chat.activeConversationId;
  return (
    <div className="shell-recent">
      <p className="shell-recent-heading">最近对话</p>
      {chat.conversationsStatus === 'loading' && (
        <div className="shell-recent-skeleton" aria-hidden="true">
          <span className="halo-skeleton" />
          <span className="halo-skeleton" />
          <span className="halo-skeleton" />
        </div>
      )}
      {chat.conversationsStatus === 'error' && (
        <p className="shell-recent-note">
          无法加载历史对话。
          <button type="button" className="halo-text-button" onClick={chat.reloadConversations}>
            重试
          </button>
        </p>
      )}
      {chat.conversationsStatus === 'ready' && !chat.conversations.length && (
        <p className="shell-recent-note">还没有历史对话。</p>
      )}
      {chat.conversations.length > 0 && (
        <ul className="shell-recent-list">
          {chat.conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/chat?c=${conversation.id}`}
                className="shell-recent-link"
                aria-current={conversation.id === activeId ? 'true' : undefined}
                title={conversation.title}
                {...(onNavigate ? { onClick: onNavigate } : {})}
              >
                <span className="shell-recent-label">{conversation.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NavSections({
  navId,
  sections,
  pathname,
  onNavigate,
}: {
  navId: string;
  sections: NavSection[];
  pathname: string;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <div className="shell-nav-scroll" id={navId}>
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => {
          const headingId = `${navId}-${section.id}`;
          return (
            <nav key={section.id} className="shell-nav-section" aria-labelledby={headingId}>
              <p className="shell-nav-heading" id={headingId}>
                {section.label}
              </p>
              <div className="shell-nav">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </nav>
          );
        })}
    </div>
  );
}

function SidebarFooter({
  me,
  variant,
  providerLabel,
  configured,
  onNavigate,
}: {
  me: MeResponse | null;
  variant: 'personal' | 'platform';
  providerLabel: string;
  configured: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <div className="shell-sidebar-foot">
      {variant === 'personal' && (
        <Link
          className="shell-provider"
          href="/account"
          data-configured={configured}
          aria-label={`模型状态：${providerLabel}`}
          title={providerLabel}
          {...(onNavigate ? { onClick: onNavigate } : {})}
        >
          <span className="shell-provider-dot" aria-hidden="true" />
          <span>{providerLabel}</span>
        </Link>
      )}
      <Link
        className="shell-account"
        href={me ? '/account' : '/'}
        aria-label={me ? `账号与设置：${me.user.displayName}` : '登录'}
        {...(onNavigate ? { onClick: onNavigate } : {})}
      >
        {me ? (
          <>
            <Avatar name={me.user.displayName} />
            <span className="shell-account-text">
              <span className="shell-account-name">{me.user.displayName}</span>
              <span className="shell-account-mail">{me.user.email}</span>
            </span>
          </>
        ) : (
          <span className="shell-account-text">
            <span className="shell-account-name">未登录</span>
            <span className="shell-account-mail">点击登录</span>
          </span>
        )}
      </Link>
    </div>
  );
}

/**
 * Shared Web shell. Every page renders inside it so navigation, typography,
 * colours and spacing stay consistent across the personal app and the
 * engineering/admin pages.
 *
 * Desktop sidebar: grouped navigation that collapses to an icon rail and keeps
 * the choice in localStorage. Mobile: top-bar menu + bottom navigation, with a
 * drawer for the destinations that do not fit in the bottom bar.
 */
export function AppShell({
  me,
  children,
  variant = 'personal',
}: {
  me: MeResponse | null;
  children: ReactNode;
  variant?: 'personal' | 'platform';
}) {
  const pathname = usePathname() ?? '/';
  const provider = useProviderStatus(variant === 'personal' && Boolean(me));
  const configured = provider.status?.configured ?? false;
  const providerLabel = provider.status
    ? configured
      ? `${provider.status.model}`
      : '未配置真实模型'
    : '正在读取模型状态';
  const isOrganizationConsole = pathname.startsWith('/organizations/');
  const isAdminPage = pathname === '/admin';
  const primaryNav =
    variant === 'personal'
      ? personalPrimaryNav
      : isOrganizationConsole
        ? []
        : isAdminPage
          ? [
              { href: '/admin', label: '平台配置', icon: 'wrench' as const },
              { href: '/connectors', label: '账号授权', icon: 'plug' as const },
              { href: '/diagnostics', label: '工程诊断', icon: 'wrench' as const },
            ]
          : [
              { href: '/apps', label: '连接应用', icon: 'apps' as const },
              { href: '/connectors', label: '账号授权', icon: 'plug' as const },
              { href: '/diagnostics', label: '工程诊断', icon: 'wrench' as const },
            ];
  const mobileNav =
    variant === 'personal' ? personalMobileNav : isOrganizationConsole ? [] : primaryNav;
  const sections: NavSection[] =
    variant === 'personal'
      ? [
          { id: 'conversation', label: '对话', items: personalPrimaryNav },
          { id: 'space', label: '我的空间', items: personalSecondaryNav },
        ]
      : [{ id: 'platform', label: isAdminPage ? '平台管理' : '平台', items: primaryNav }];

  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);
  // Tag the drawer with the route it was opened on, so navigating closes it
  // without an effect that resets state after the render.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === pathname;
  const [appsPath, setAppsPath] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const appsTrigger = useRef<HTMLElement | null>(null);
  const openApps = () => {
    appsTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAppsPath(pathname);
  };
  const openDrawer = () => setDrawerPath(pathname);
  const closeDrawer = () => setDrawerPath(null);
  const openProfile = () => setProfileOpen(true);
  const closeProfile = () => setProfileOpen(false);
  const toggleCollapsed = () => writeSidebarCollapsed(!collapsed);
  const moreActive = personalMorePaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  return (
    <div
      className="shell aven-theme-halo personal-app"
      data-variant={variant}
      data-org-console={isOrganizationConsole || undefined}
      data-conversation={
        (variant === 'personal' && (pathname === '/' || pathname === '/chat')) || undefined
      }
      data-profile-open={profileOpen || undefined}
    >
      <aside className="shell-sidebar" data-collapsed={collapsed ? 'true' : 'false'}>
        <div className="shell-sidebar-top">
          {variant === 'personal' && (pathname === '/' || pathname === '/chat') ? (
            <>
              <button
                type="button"
                className="shell-collapse"
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                aria-expanded={!collapsed}
                aria-controls="shell-nav"
                title={collapsed ? '展开侧栏' : '收起侧栏'}
                onClick={toggleCollapsed}
              >
                <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} size={18} />
              </button>
              <SidebarBotButton onOpenProfile={openProfile} />
            </>
          ) : (
            <>
              <Link className="shell-brand" href="/" aria-label="AVEN 首页">
                <span className="shell-brand-mark">A</span>
                <span className="shell-brand-name">AVEN</span>
              </Link>
              <button
                type="button"
                className="shell-collapse"
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                aria-expanded={!collapsed}
                aria-controls="shell-nav"
                title={collapsed ? '展开侧栏' : '收起侧栏'}
                onClick={toggleCollapsed}
              >
                <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} size={18} />
              </button>
            </>
          )}
        </div>
        {variant === 'personal' ? (
          <>
            <nav aria-label="对话">
              <NewChatButton
                current={(pathname === '/' || pathname === '/chat') && appsPath !== pathname}
              />
            </nav>
            <NavSections
              navId="shell-nav"
              sections={desktopPersonalSections}
              pathname={pathname}
              onNavigate={profileOpen ? closeProfile : undefined}
            />
            <RecentConversations />
            <NavLink item={appsNavItem} pathname={pathname} onOpenApps={openApps} />
          </>
        ) : (
          <NavSections navId="shell-nav" sections={sections} pathname={pathname} />
        )}
        <SidebarFooter
          me={me}
          variant={variant}
          providerLabel={providerLabel}
          configured={configured}
        />
      </aside>
      <div className="shell-body">
        <header className="shell-topbar">
          {variant === 'personal' ? (
            <button
              type="button"
              className="shell-topbar-menu"
              aria-label="打开导航"
              aria-expanded={drawerOpen}
              onClick={openDrawer}
            >
              <Icon name="menu" size={22} />
            </button>
          ) : null}
          <Link className="shell-brand shell-topbar-brand" href="/">
            <span className="shell-brand-mark">A</span>
            AVEN
          </Link>
          <span className="shell-topbar-spacer" />
          <Link
            className="shell-account"
            href={me ? '/account' : '/'}
            aria-label={me ? '我的账号' : '登录'}
          >
            {me ? <Avatar name={me.user.displayName} /> : <span className="shell-login">登录</span>}
          </Link>
        </header>
        <main className="shell-main">
          <ShellNavigationContext.Provider value={openDrawer}>
            <ShellAppsContext.Provider value={variant === 'personal' ? openApps : undefined}>
              <ShellProfileContext.Provider value={variant === 'personal' ? openProfile : undefined}>
                {children}
              </ShellProfileContext.Provider>
            </ShellAppsContext.Provider>
          </ShellNavigationContext.Provider>
        </main>
        <nav
          className="shell-bottomnav"
          aria-label={variant === 'personal' ? '个人导航' : '平台导航'}
          data-org-console={isOrganizationConsole || undefined}
        >
          {mobileNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onOpenApps={variant === 'personal' ? openApps : undefined}
            />
          ))}
          {variant === 'personal' ? (
            <button
              type="button"
              className="shell-nav-link shell-nav-more"
              aria-label="更多导航"
              aria-expanded={drawerOpen}
              aria-current={moreActive ? 'page' : undefined}
              onClick={openDrawer}
            >
              <Icon name="menu" size={20} />
              <span className="shell-nav-label">更多</span>
            </button>
          ) : null}
        </nav>
      </div>
      {variant === 'personal' && (
        <BotInfoDrawer open={profileOpen} onOpenChange={setProfileOpen} onOpenApps={openApps} />
      )}
      {variant === 'personal' && (
        <DialogPrimitive.Root
          open={appsPath === pathname}
          onOpenChange={(open) => {
            if (!open) setAppsPath(null);
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="apps-dialog-overlay" />
            <DialogPrimitive.Content
              className="apps-dialog personal-app aven-theme-halo"
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                appsTrigger.current?.focus();
              }}
            >
              <AppsCatalog dialog />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
      {variant === 'personal' ? (
        <DialogPrimitive.Root
          open={drawerOpen}
          onOpenChange={(open) => setDrawerPath(open ? pathname : null)}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="shell-drawer-mask" />
            <DialogPrimitive.Content
              className="shell-drawer aven-theme-halo personal-app"
              aria-describedby={undefined}
            >
              <DialogPrimitive.Title className="sr-only">导航</DialogPrimitive.Title>
              <div className="shell-sidebar-top">
                <Link className="shell-brand" href="/" aria-label="AVEN 首页" onClick={closeDrawer}>
                  <span className="shell-brand-mark">A</span>
                  <span className="shell-brand-name">AVEN</span>
                </Link>
                <DialogPrimitive.Close className="shell-collapse" aria-label="关闭导航">
                  <Icon name="x" size={18} />
                </DialogPrimitive.Close>
              </div>
              <NewChatButton onNavigate={closeDrawer} />
              <RecentConversations onNavigate={closeDrawer} />
              <NavSections
                navId="shell-drawer-nav"
                sections={sections}
                pathname={pathname}
                onNavigate={closeDrawer}
              />
              <SidebarFooter
                me={me}
                variant={variant}
                providerLabel={providerLabel}
                configured={configured}
                onNavigate={closeDrawer}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : null}
    </div>
  );
}
