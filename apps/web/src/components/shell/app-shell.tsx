'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MeResponse } from '@aven/contracts';
import { Icon, type IconName } from '@/features/personal/icon';
import { useProviderStatus } from '@/features/personal/use-provider-status';
import './shell.css';

type NavItem = { href: string; label: string; icon: IconName; activeOn?: string[] };

const personalPrimaryNav: NavItem[] = [
  { href: '/', label: '首页', icon: 'new-chat' },
  { href: '/chat', label: '对话', icon: 'chat' },
  { href: '/connections', label: '我的连接', icon: 'link' },
];

const personalSecondaryNav: NavItem[] = [
  { href: '/apps', label: '连接应用', icon: 'apps' },
  { href: '/memory', label: '记忆与上下文', icon: 'library' },
  { href: '/notifications', label: '通知', icon: 'bell' },
  { href: '/profile', label: 'Bot 资料', icon: 'profile' },
];

const personalMobileNav: NavItem[] = [
  { href: '/', label: '首页', icon: 'new-chat' },
  { href: '/chat', label: '对话', icon: 'chat' },
  { href: '/connections', label: '连接', icon: 'link' },
  { href: '/apps', label: '应用', icon: 'apps' },
  {
    href: '/profile',
    label: '更多',
    icon: 'profile',
    activeOn: ['/profile', '/memory', '/notifications', '/account'],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (item.activeOn?.includes(pathname)) return true;
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      className="shell-nav-link"
      aria-label={item.label}
      title={item.label}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={item.icon} size={20} />
      <span className="shell-nav-label">{item.label}</span>
    </Link>
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
 * Shared Web shell. Every page renders inside it so navigation, typography,
 * colours and spacing stay consistent across the personal app and the
 * engineering/admin pages.
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
  const secondaryNav = variant === 'personal' ? personalSecondaryNav : [];
  const mobileNav =
    variant === 'personal' ? personalMobileNav : isOrganizationConsole ? [] : primaryNav;

  return (
    <div
      className="shell aven-theme-halo personal-app"
      data-variant={variant}
      data-org-console={isOrganizationConsole || undefined}
    >
      <aside className="shell-sidebar">
        <Link className="shell-brand" href="/" aria-label="AVEN 首页">
          <span className="shell-brand-mark">A</span>
          <span className="shell-brand-name">AVEN</span>
        </Link>
        <nav className="shell-nav" aria-label="主导航">
          {primaryNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        {secondaryNav.length > 0 && (
          <nav className="shell-nav" aria-label="个人空间">
            {secondaryNav.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>
        )}
        <div className="shell-sidebar-foot">
          {variant === 'personal' && (
            <Link
              className="shell-provider"
              href="/account"
              data-configured={configured}
              aria-label={`模型状态：${providerLabel}`}
              title={providerLabel}
            >
              <span className="shell-provider-dot" aria-hidden="true" />
              <span>{providerLabel}</span>
            </Link>
          )}
          <Link
            className="shell-account"
            href={me ? '/account' : '/'}
            aria-label={me ? `账号与设置：${me.user.displayName}` : '登录'}
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
      </aside>
      <div className="shell-body">
        <header className="shell-topbar">
          <Link className="shell-brand" href="/">
            <span className="shell-brand-mark">A</span>
            AVEN
          </Link>
          <Link
            className="shell-account"
            href={me ? '/account' : '/'}
            aria-label={me ? '我的账号' : '登录'}
          >
            {me ? <Avatar name={me.user.displayName} /> : <span className="shell-login">登录</span>}
          </Link>
        </header>
        <main className="shell-main">{children}</main>
        <nav
          className="shell-bottomnav"
          aria-label={variant === 'personal' ? '个人导航' : '平台导航'}
          data-org-console={isOrganizationConsole || undefined}
        >
          {mobileNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
      </div>
    </div>
  );
}
