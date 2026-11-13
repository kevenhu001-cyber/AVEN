'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MeResponse } from '@aven/contracts';
import { Icon, type IconName } from '@/features/personal/icon';
import { useProviderStatus } from '@/features/personal/use-provider-status';
import './shell.css';

type NavItem = { href: string; label: string; icon: IconName };

const primaryNav: NavItem[] = [
  { href: '/', label: '首页', icon: 'new-chat' },
  { href: '/chat', label: '对话', icon: 'chat' },
  { href: '/apps', label: '连接应用', icon: 'apps' },
  { href: '/memory', label: '记忆', icon: 'library' },
  { href: '/connections', label: '我的连接', icon: 'link' },
  { href: '/notifications', label: '通知', icon: 'bell' },
];

const secondaryNav: NavItem[] = [
  { href: '/profile', label: 'Bot 资料', icon: 'profile' },
  { href: '/connectors', label: '账号授权', icon: 'plug' },
  { href: '/account', label: '账号与设置', icon: 'profile' },
  { href: '/diagnostics', label: '工程诊断', icon: 'wrench' },
];

const mobileNav: NavItem[] = [
  { href: '/', label: '首页', icon: 'new-chat' },
  { href: '/chat', label: '对话', icon: 'chat' },
  { href: '/apps', label: '应用', icon: 'apps' },
  { href: '/memory', label: '记忆', icon: 'library' },
  { href: '/notifications', label: '通知', icon: 'bell' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link href={item.href} className="shell-nav-link" aria-current={active ? 'page' : undefined}>
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
export function AppShell({ me, children }: { me: MeResponse | null; children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const provider = useProviderStatus(Boolean(me));
  const configured = provider.status?.configured ?? false;
  const providerLabel = provider.status
    ? configured
      ? `${provider.status.model}`
      : '未配置真实模型'
    : '正在读取模型状态';

  return (
    <div className="shell aven-theme-halo personal-app">
      <aside className="shell-sidebar">
        <Link className="shell-brand" href="/">
          <span className="shell-brand-mark">A</span>
          AVEN
        </Link>
        <nav className="shell-nav" aria-label="主导航">
          {primaryNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <nav className="shell-nav" aria-label="设置与工具">
          {secondaryNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <div className="shell-sidebar-foot">
          <Link className="shell-provider" href="/account" data-configured={configured}>
            <span className="shell-provider-dot" aria-hidden="true" />
            <span>{providerLabel}</span>
          </Link>
          <Link className="shell-account" href={me ? '/account' : '/'}>
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
        <nav className="shell-bottomnav" aria-label="底部导航">
          {mobileNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
      </div>
    </div>
  );
}
