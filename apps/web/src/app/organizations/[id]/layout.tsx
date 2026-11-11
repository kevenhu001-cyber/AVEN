'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import type { ReactNode } from 'react';

export default function OrganizationConsoleLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const orgId = params?.id ?? '';

  const navItems = [
    { label: '概览 Overview', path: `/organizations/${orgId}` },
    { label: '机会管理 Opportunities', path: `/organizations/${orgId}/opportunities` },
    { label: '成员管理 Members', path: `/organizations/${orgId}/members` },
    { label: '收件箱 Inbox', path: `/organizations/${orgId}/inbox` },
  ];

  return (
    <main className="workspace">
      <header className="masthead">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--aven-space-12)' }}>
          <Link
            href="/"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              fontWeight: 'var(--aven-font-weight-semibold)',
            }}
          >
            <span className="brand">AVEN</span>
          </Link>
          <span style={{ color: 'var(--aven-color-border-strong)' }}>/</span>
          <span style={{ color: 'var(--aven-color-foreground-secondary)' }}>组织控制台</span>
        </div>
        <span className="stage">M4 · 组织与机会</span>
      </header>

      <nav
        aria-label="组织控制台导航"
        style={{
          display: 'flex',
          gap: 'var(--aven-space-8)',
          borderBottom: '1px solid var(--aven-color-border)',
          margin: 'var(--aven-space-24) 0',
          overflowX: 'auto',
          paddingBottom: '2px',
        }}
      >
        {navItems.map((item) => {
          const isActive =
            item.path === `/organizations/${orgId}`
              ? pathname === item.path
              : pathname.startsWith(item.path);

          return (
            <Link
              key={item.path}
              href={item.path}
              style={{
                textDecoration: 'none',
                padding: 'var(--aven-space-12) var(--aven-space-16)',
                borderRadius: 'var(--aven-radius-sm)',
                fontSize: 'var(--aven-font-size-body-sm)',
                fontWeight: isActive ? 600 : 400,
                color: isActive
                  ? 'var(--aven-color-primary)'
                  : 'var(--aven-color-foreground-secondary)',
                borderBottom: isActive
                  ? '2px solid var(--aven-color-primary)'
                  : '2px solid transparent',
                marginBottom: '-2px',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </main>
  );
}
