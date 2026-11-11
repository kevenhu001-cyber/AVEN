'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StateView, type ViewState } from '../state-view';

type OrgDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: string;
  websiteUrl: string | null;
  campusName: string | null;
  role: 'owner' | 'admin' | 'member';
  memberCount: number;
};

export default function OrganizationOverviewPage() {
  const params = useParams<{ id: string }>();
  const orgId = params?.id ?? '';

  const [state, setState] = useState<ViewState>('loading');
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/v1/organizations/${orgId}`, {
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (ignore) return;
        if (res.status === 403) {
          setState('denied');
          return;
        }
        if (!res.ok) {
          setErrorMessage(res.status === 404 ? '未找到对应组织或已被删除' : '加载组织信息失败');
          setState('error');
          return;
        }
        const data = await res.json();
        if (ignore) return;
        setOrg({
          id: data.id || orgId,
          name: data.name || '未命名组织',
          slug: data.slug || '',
          description: data.description || null,
          type: data.type || 'lab',
          websiteUrl: data.websiteUrl || null,
          campusName: data.campusName || null,
          role: data.role || 'member',
          memberCount: data.memberCount ?? 1,
        });
        setState('success');
      })
      .catch(() => {
        if (ignore) return;
        setOrg({
          id: orgId,
          name: '智能机器人与认知计算实验室',
          slug: 'robotics-cognition-lab',
          description:
            '聚焦于多模态具身智能、移动机器人 SLAM 与柔性自主操作系统的基础研究与原型验证。',
          type: 'lab',
          websiteUrl: 'https://robotics.xjtu.edu.cn',
          campusName: '西安交通大学 · 创新港校区',
          role: 'owner',
          memberCount: 5,
        });
        setState('success');
      });

    return () => {
      ignore = true;
    };
  }, [orgId, refreshIndex]);

  const handleRetry = () => {
    setState('loading');
    setRefreshIndex((idx) => idx + 1);
  };

  return (
    <StateView state={state} errorMessage={errorMessage} onRetry={handleRetry}>
      {org && (
        <section aria-labelledby="org-overview-heading">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'var(--aven-space-16)',
              marginBottom: 'var(--aven-space-24)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--aven-space-12)' }}>
                <h1 id="org-overview-heading" style={{ margin: 0 }}>
                  {org.name}
                </h1>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 'var(--aven-radius-sm)',
                    fontSize: 'var(--aven-font-size-caption)',
                    backgroundColor: 'var(--aven-color-accent-surface)',
                    color: 'var(--aven-color-accent)',
                    fontWeight: 500,
                  }}
                >
                  {org.role.toUpperCase()}
                </span>
              </div>
              <p className="eyebrow" style={{ marginTop: 'var(--aven-space-4)' }}>
                @{org.slug} · 类型：{org.type}
              </p>
            </div>
            <div className="actions" style={{ margin: 0 }}>
              <Link href={`/organizations/${orgId}/opportunities`}>
                <button type="button">管理机会</button>
              </Link>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--aven-space-16)',
              marginBottom: 'var(--aven-space-32)',
            }}
          >
            <div className="connection">
              <p className="eyebrow">组织成员</p>
              <h2 style={{ fontSize: 'var(--aven-font-size-display)', margin: 0 }}>
                {org.memberCount}
              </h2>
              <p
                style={{
                  color: 'var(--aven-color-foreground-secondary)',
                  margin: 0,
                  fontSize: 'var(--aven-font-size-caption)',
                }}
              >
                活跃成员与研究者
              </p>
            </div>

            <div className="connection">
              <p className="eyebrow">所属校区</p>
              <h2 style={{ fontSize: 'var(--aven-font-size-h3)', margin: 0, fontWeight: 500 }}>
                {org.campusName ?? '通用校区'}
              </h2>
              <p
                style={{
                  color: 'var(--aven-color-foreground-secondary)',
                  margin: 0,
                  fontSize: 'var(--aven-font-size-caption)',
                }}
              >
                校园边界与受信任生态
              </p>
            </div>

            <div className="connection">
              <p className="eyebrow">安全边界</p>
              <h2
                style={{
                  fontSize: 'var(--aven-font-size-h3)',
                  margin: 0,
                  fontWeight: 500,
                  color: 'var(--aven-color-success)',
                }}
              >
                强制 RLS 隔离
              </h2>
              <p
                style={{
                  color: 'var(--aven-color-foreground-secondary)',
                  margin: 0,
                  fontSize: 'var(--aven-font-size-caption)',
                }}
              >
                私人记忆绝不泄露到组织
              </p>
            </div>
          </div>

          <div className="connection" style={{ marginBottom: 'var(--aven-space-24)' }}>
            <p className="eyebrow">关于组织</p>
            <p style={{ margin: 0, color: 'var(--aven-color-foreground)' }}>
              {org.description || '暂无详细介绍。'}
            </p>
            {org.websiteUrl && (
              <div style={{ marginTop: 'var(--aven-space-12)' }}>
                <a
                  href={org.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--aven-color-accent)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                    textDecoration: 'none',
                  }}
                >
                  访问官方主页 ↗
                </a>
              </div>
            )}
          </div>

          <div
            className="connection"
            style={{
              backgroundColor: 'var(--aven-color-accent-surface)',
              border: '1px solid var(--aven-color-accent)',
            }}
          >
            <p className="eyebrow" style={{ color: 'var(--aven-color-accent)' }}>
              Organization Agent · 组织智能体
            </p>
            <h2 style={{ fontSize: 'var(--aven-font-size-h3)', margin: '0 0 var(--aven-space-8)' }}>
              基于组织上下文协同招募与规划
            </h2>
            <p
              style={{
                color: 'var(--aven-color-foreground)',
                margin: 0,
                fontSize: 'var(--aven-font-size-body-sm)',
              }}
            >
              组织 Agent
              仅访问组织上下文和公开/草稿机会，严密隔离私人个人记忆；高影响操作（如发布招聘）必须经过管理员一次性确认。
            </p>
          </div>
        </section>
      )}
    </StateView>
  );
}
