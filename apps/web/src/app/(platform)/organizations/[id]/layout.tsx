'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/features/personal/icon';

export default function OrganizationConsoleLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const orgId = params?.id ?? '';

  const navItems: Array<{ label: string; path: string; icon: IconName }> = [
    { label: '概览', path: `/organizations/${orgId}`, icon: 'apps' },
    { label: '机会管理', path: `/organizations/${orgId}/opportunities`, icon: 'sparkles' },
    { label: '成员管理', path: `/organizations/${orgId}/members`, icon: 'users' },
    { label: '收件箱', path: `/organizations/${orgId}/inbox`, icon: 'inbox' },
  ];

  return (
    <div className="page-wide">
      <header className="page-head">
        <div>
          <p className="org-eyebrow">组织控制台</p>
          <h1>组织与机会</h1>
        </div>
        <div className="page-actions">
          <Link
            className="shell-link-button"
            href="/"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Icon name="back" size={14} />
            <span>返回 AVEN</span>
          </Link>
        </div>
      </header>
      <nav className="org-tabs" aria-label="组织控制台导航">
        {navItems.map((item) => {
          const isActive =
            item.path === `/organizations/${orgId}`
              ? pathname === item.path
              : pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              className="org-tab"
              aria-current={isActive ? 'page' : undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Icon name={item.icon} size={14} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
