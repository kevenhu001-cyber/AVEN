'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import type { ReactNode } from 'react';

export default function OrganizationConsoleLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const orgId = params?.id ?? '';

  const navItems = [
    { label: '概览', path: `/organizations/${orgId}` },
    { label: '机会管理', path: `/organizations/${orgId}/opportunities` },
    { label: '成员管理', path: `/organizations/${orgId}/members` },
    { label: '收件箱', path: `/organizations/${orgId}/inbox` },
  ];

  return (
    <div className="page-wide">
      <header className="page-head">
        <div>
          <p className="org-eyebrow">组织控制台</p>
          <h1>组织与机会</h1>
        </div>
        <div className="page-actions">
          <Link className="shell-link-button" href="/">
            返回 AVEN
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
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
