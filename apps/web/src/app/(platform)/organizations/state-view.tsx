'use client';

import type { ReactNode } from 'react';

export type ViewState = 'loading' | 'empty' | 'error' | 'denied' | 'success';

export interface StateViewProps {
  state: ViewState;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  errorMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
}

export function StateView({
  state,
  emptyTitle = '暂无数据',
  emptyMessage = '当前列表为空，您可以稍后查看或创建新内容。',
  emptyAction,
  errorMessage = '请求失败，请检查网络或权限设置。',
  onRetry,
  children,
}: StateViewProps) {
  if (state === 'loading') {
    return (
      <div
        className="connection"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '240px',
          gap: 'var(--aven-space-16)',
        }}
        role="status"
        aria-live="polite"
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: 'var(--aven-radius-full)',
            border: '3px solid var(--aven-color-border)',
            borderTopColor: 'var(--aven-color-primary)',
            animation: 'spin 1s linear infinite',
          }}
        />
        <p style={{ color: 'var(--aven-color-foreground-secondary)', margin: 0 }}>
          正在加载数据，请稍候...
        </p>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div
        className="connection"
        style={{
          borderLeft: '4px solid var(--aven-color-destructive)',
          padding: 'var(--aven-space-24)',
        }}
        role="alert"
      >
        <p className="eyebrow" style={{ color: 'var(--aven-color-destructive)' }}>
          访问受限 · 403 Forbidden
        </p>
        <h2 style={{ fontSize: 'var(--aven-font-size-h3)' }}>权限不足</h2>
        <p style={{ color: 'var(--aven-color-foreground-secondary)', margin: 0 }}>
          您不是该组织的有效成员，或当前角色无权查看组织控制台。如有疑问，请联系组织管理员。
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div
        className="connection"
        style={{
          borderLeft: '4px solid var(--aven-color-destructive)',
          padding: 'var(--aven-space-24)',
        }}
        role="alert"
      >
        <p className="eyebrow" style={{ color: 'var(--aven-color-destructive)' }}>
          加载错误
        </p>
        <h2 style={{ fontSize: 'var(--aven-font-size-h3)' }}>未能完成请求</h2>
        <p style={{ color: 'var(--aven-color-foreground-secondary)' }}>{errorMessage}</p>
        {onRetry && (
          <div className="actions" style={{ margin: 'var(--aven-space-12) 0 0' }}>
            <button type="button" onClick={onRetry} className="secondary">
              重试
            </button>
          </div>
        )}
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div
        className="connection"
        style={{
          textAlign: 'center',
          padding: 'var(--aven-space-48) var(--aven-space-24)',
        }}
      >
        <p className="eyebrow">{emptyTitle}</p>
        <p
          style={{
            color: 'var(--aven-color-foreground-secondary)',
            maxWidth: '400px',
            margin: '0 auto var(--aven-space-20)',
          }}
        >
          {emptyMessage}
        </p>
        {emptyAction && <div style={{ display: 'inline-block' }}>{emptyAction}</div>}
      </div>
    );
  }

  return <>{children}</>;
}
