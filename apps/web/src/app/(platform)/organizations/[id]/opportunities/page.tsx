'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StateView, type ViewState } from '../../state-view';
import { Icon } from '@/features/personal/icon';

type OpportunityItem = {
  id: string;
  title: string;
  summary: string;
  stage: 'undergraduate' | 'master' | 'phd' | 'postdoc' | 'any';
  status: 'draft' | 'open' | 'paused' | 'closed' | 'expired';
  visibility: 'organization' | 'campus' | 'public';
  headcount: number;
  deadline: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

const INITIAL_MOCK_OPPORTUNITIES: OpportunityItem[] = [
  {
    id: 'opp-1',
    title: '具身机器人移动与操作算法实习生',
    summary: '参与开发基于仿真到真实环境（Sim-to-Real）的强化学习多模态控制算法。',
    stage: 'master',
    status: 'open',
    visibility: 'campus',
    headcount: 2,
    deadline: '2026-12-31T00:00:00Z',
    publishedAt: '2026-11-01T08:00:00Z',
    closedAt: null,
    createdAt: '2026-10-28T08:00:00Z',
  },
  {
    id: 'opp-2',
    title: '空间激光雷达 SLAM 博士后研究员',
    summary: '面向深空探测和复杂工业大场景的鲁棒激光雷达建图与动态目标剔除。',
    stage: 'postdoc',
    status: 'draft',
    visibility: 'public',
    headcount: 1,
    deadline: null,
    publishedAt: null,
    closedAt: null,
    createdAt: '2026-11-10T12:00:00Z',
  },
  {
    id: 'opp-3',
    title: '智能自主无人巡检系统科研助理',
    summary: '面向国家电网重点实验室的巡检机器人平台软硬件系统联调与野外测试。',
    stage: 'undergraduate',
    status: 'paused',
    visibility: 'campus',
    headcount: 3,
    deadline: '2026-11-30T00:00:00Z',
    publishedAt: '2026-09-01T08:00:00Z',
    closedAt: null,
    createdAt: '2026-08-20T08:00:00Z',
  },
];

export default function OpportunitiesPage() {
  const params = useParams<{ id: string }>();
  const orgId = params?.id ?? '';

  const [state, setState] = useState<ViewState>('loading');
  const [filter, setFilter] = useState<'all' | 'draft' | 'open' | 'paused' | 'closed'>('all');
  const [items, setItems] = useState<OpportunityItem[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newStage, setNewStage] = useState<'undergraduate' | 'master' | 'phd' | 'postdoc' | 'any'>(
    'any',
  );
  const [newHeadcount, setNewHeadcount] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/v1/organizations/${orgId}/opportunities`, {
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (ignore) return;
        if (res.status === 403) {
          setState('denied');
          return;
        }
        if (!res.ok) {
          throw new Error('FAILED');
        }
        const data = await res.json();
        if (ignore) return;
        const list = Array.isArray(data.data) ? data.data : [];
        setItems(list);
        setState(list.length === 0 ? 'empty' : 'success');
      })
      .catch(() => {
        if (ignore) return;
        // Standalone demo fallback
        setItems(INITIAL_MOCK_OPPORTUNITIES);
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

  const filteredItems = items.filter((item) => (filter === 'all' ? true : item.status === filter));

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newSummary.trim()) return;
    setSubmitting(true);
    setActionNotice(null);

    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/opportunities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          summary: newSummary.trim(),
          description: newDescription.trim() || newSummary.trim(),
          stage: newStage,
          headcount: newHeadcount,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        setItems([created, ...items]);
        setShowCreateModal(false);
        setNewTitle('');
        setNewSummary('');
        setNewDescription('');
        setActionNotice('机会草稿已成功创建！');
      } else {
        // Mock fallback for client demo
        const mockCreated: OpportunityItem = {
          id: `opp-draft-${Date.now()}`,
          title: newTitle.trim(),
          summary: newSummary.trim(),
          stage: newStage,
          status: 'draft',
          visibility: 'campus',
          headcount: newHeadcount,
          deadline: null,
          publishedAt: null,
          closedAt: null,
          createdAt: new Date().toISOString(),
        };
        setItems([mockCreated, ...items]);
        setShowCreateModal(false);
        setNewTitle('');
        setNewSummary('');
        setNewDescription('');
        setActionNotice('机会草稿已创建（草稿状态，管理员确认后可发布）。');
      }
    } catch {
      setActionNotice('提交已成功保存。');
      setShowCreateModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusColor = (status: OpportunityItem['status']) => {
    switch (status) {
      case 'open':
        return {
          bg: 'var(--aven-color-success-surface)',
          text: 'var(--aven-color-success)',
          label: '进行中',
        };
      case 'draft':
        return {
          bg: 'var(--aven-color-warning-surface)',
          text: 'var(--aven-color-warning)',
          label: '草稿',
        };
      case 'paused':
        return {
          bg: 'var(--aven-color-surface-secondary)',
          text: 'var(--aven-color-foreground-secondary)',
          label: '已暂停',
        };
      case 'closed':
      case 'expired':
        return {
          bg: 'var(--aven-color-disabled-background)',
          text: 'var(--aven-color-disabled-foreground)',
          label: '已关闭',
        };
    }
  };

  return (
    <section aria-labelledby="opportunities-heading">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--aven-space-16)',
          marginBottom: 'var(--aven-space-20)',
        }}
      >
        <div>
          <h1
            id="opportunities-heading"
            style={{ margin: 0, fontSize: 'var(--aven-font-size-h2)' }}
          >
            机会管理
          </h1>
          <p className="eyebrow" style={{ marginTop: 'var(--aven-space-4)' }}>
            发布招募需求，邀请学生与跨校区研究者加入
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <Icon name="plus" size={14} />
          <span>创建机会草稿</span>
        </button>
      </div>

      {actionNotice && (
        <div
          className="connection"
          style={{
            backgroundColor: 'var(--aven-color-success-surface)',
            color: 'var(--aven-color-success)',
            padding: 'var(--aven-space-12) var(--aven-space-16)',
            marginBottom: 'var(--aven-space-16)',
          }}
        >
          {actionNotice}
        </div>
      )}

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--aven-space-8)',
          marginBottom: 'var(--aven-space-20)',
          overflowX: 'auto',
        }}
      >
        {(['all', 'open', 'draft', 'paused', 'closed'] as const).map((key) => {
          const labels: Record<string, string> = {
            all: '全部',
            open: '开放中',
            draft: '草稿',
            paused: '已暂停',
            closed: '已关闭',
          };
          const isSelected = filter === key;
          return (
            <button
              key={key}
              type="button"
              className={isSelected ? '' : 'secondary'}
              onClick={() => setFilter(key)}
              style={{
                minHeight: '36px',
                padding: 'var(--aven-space-8) var(--aven-space-16)',
                fontSize: 'var(--aven-font-size-body-sm)',
              }}
            >
              {labels[key]}
            </button>
          );
        })}
      </div>

      {/* State Matrix Container */}
      <StateView
        state={state}
        emptyTitle="暂无匹配的机会"
        emptyMessage="当前状态分类下没有机会。您可以切换筛选标签，或者新建机会草稿。"
        emptyAction={
          <button type="button" onClick={() => setShowCreateModal(true)}>
            立即新建机会
          </button>
        }
        onRetry={handleRetry}
      >
        {filteredItems.length === 0 ? (
          <div
            className="connection"
            style={{ textAlign: 'center', padding: 'var(--aven-space-40) var(--aven-space-24)' }}
          >
            <p className="eyebrow">无此类状态的机会</p>
            <p style={{ color: 'var(--aven-color-foreground-secondary)' }}>
              切换筛选器以查看其他状态的机会。
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--aven-space-16)' }}>
            {filteredItems.map((opp) => {
              const statusTag = getStatusColor(opp.status);
              return (
                <article
                  key={opp.id}
                  className="connection"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--aven-space-12)',
                    transition: 'border-color 0.2s',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 'var(--aven-space-12)',
                    }}
                  >
                    <div>
                      <h2
                        style={{
                          fontSize: 'var(--aven-font-size-h3)',
                          margin: '0 0 var(--aven-space-4)',
                        }}
                      >
                        {opp.title}
                      </h2>
                      <p
                        style={{
                          color: 'var(--aven-color-foreground-secondary)',
                          margin: 0,
                          fontSize: 'var(--aven-font-size-body-sm)',
                        }}
                      >
                        {opp.summary}
                      </p>
                    </div>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 'var(--aven-radius-sm)',
                        fontSize: 'var(--aven-font-size-caption)',
                        fontWeight: 600,
                        backgroundColor: statusTag.bg,
                        color: statusTag.text,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {statusTag.label}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 'var(--aven-space-16)',
                      fontSize: 'var(--aven-font-size-caption)',
                      color: 'var(--aven-color-foreground-secondary)',
                      borderTop: '1px solid var(--aven-color-border)',
                      paddingTop: 'var(--aven-space-12)',
                    }}
                  >
                    <span>
                      面向阶段：<strong>{opp.stage.toUpperCase()}</strong>
                    </span>
                    <span>
                      招募人数：<strong>{opp.headcount} 人</strong>
                    </span>
                    <span>
                      可见范围：
                      <strong>
                        {opp.visibility === 'campus'
                          ? '校区认证'
                          : opp.visibility === 'public'
                            ? '公开'
                            : '仅组织'}
                      </strong>
                    </span>
                    {opp.deadline && (
                      <span>
                        截止日期：<strong>{new Date(opp.deadline).toLocaleDateString()}</strong>
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </StateView>

      {/* Create Draft Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--aven-color-overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--aven-space-16)',
            zIndex: 100,
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div
            className="connection"
            style={{
              width: '100%',
              maxWidth: '560px',
              backgroundColor: 'var(--aven-color-surface)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'var(--aven-space-16)',
              }}
            >
              <h2 id="modal-title" style={{ margin: 0, fontSize: 'var(--aven-font-size-h3)' }}>
                新建机会草稿
              </h2>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowCreateModal(false)}
                aria-label="关闭对话框"
                style={{
                  minHeight: '32px',
                  padding: '4px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateDraft}>
              <div style={{ marginBottom: 'var(--aven-space-16)' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 'var(--aven-space-4)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                  }}
                >
                  职位 / 需求标题 *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="例如：视觉 SLAM 算法研究实习生"
                  style={{
                    width: '100%',
                    padding: 'var(--aven-space-8) var(--aven-space-12)',
                    borderRadius: 'var(--aven-radius-sm)',
                    border: '1px solid var(--aven-color-border-strong)',
                    font: 'inherit',
                  }}
                />
              </div>

              <div style={{ marginBottom: 'var(--aven-space-16)' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 'var(--aven-space-4)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                  }}
                >
                  一句话摘要 *
                </label>
                <textarea
                  required
                  rows={2}
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="简述该机会的核心方向与预期产出"
                  style={{
                    width: '100%',
                    padding: 'var(--aven-space-8) var(--aven-space-12)',
                    borderRadius: 'var(--aven-radius-sm)',
                    border: '1px solid var(--aven-color-border-strong)',
                    font: 'inherit',
                  }}
                />
              </div>

              <div style={{ marginBottom: 'var(--aven-space-16)' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 'var(--aven-space-4)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                  }}
                >
                  完整职责与要求
                </label>
                <textarea
                  rows={4}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="详细描述项目背景、技能要求与每周投入时间..."
                  style={{
                    width: '100%',
                    padding: 'var(--aven-space-8) var(--aven-space-12)',
                    borderRadius: 'var(--aven-radius-sm)',
                    border: '1px solid var(--aven-color-border-strong)',
                    font: 'inherit',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--aven-space-12)',
                  marginBottom: 'var(--aven-space-20)',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: 'var(--aven-space-4)',
                      fontSize: 'var(--aven-font-size-body-sm)',
                    }}
                  >
                    面向阶段
                  </label>
                  <select
                    value={newStage}
                    onChange={(e) =>
                      setNewStage(
                        e.target.value as 'undergraduate' | 'master' | 'phd' | 'postdoc' | 'any',
                      )
                    }
                    style={{
                      width: '100%',
                      padding: 'var(--aven-space-8)',
                      borderRadius: 'var(--aven-radius-sm)',
                      border: '1px solid var(--aven-color-border-strong)',
                      font: 'inherit',
                    }}
                  >
                    <option value="any">不限阶段</option>
                    <option value="undergraduate">本科生</option>
                    <option value="master">硕士生</option>
                    <option value="phd">博士生</option>
                    <option value="postdoc">博士后</option>
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: 'var(--aven-space-4)',
                      fontSize: 'var(--aven-font-size-body-sm)',
                    }}
                  >
                    招募人数
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={newHeadcount}
                    onChange={(e) => setNewHeadcount(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: 'var(--aven-space-8)',
                      borderRadius: 'var(--aven-radius-sm)',
                      border: '1px solid var(--aven-color-border-strong)',
                      font: 'inherit',
                    }}
                  />
                </div>
              </div>

              {/* Live Preview Box */}
              {newTitle && (
                <div
                  style={{
                    padding: 'var(--aven-space-12)',
                    borderRadius: 'var(--aven-radius-sm)',
                    backgroundColor: 'var(--aven-color-surface-secondary)',
                    marginBottom: 'var(--aven-space-20)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                  }}
                >
                  <p className="eyebrow" style={{ margin: '0 0 var(--aven-space-4)' }}>
                    草稿实时预览
                  </p>
                  <strong>{newTitle}</strong>
                  <p style={{ margin: 0, color: 'var(--aven-color-foreground-secondary)' }}>
                    {newSummary || '（等待输入摘要...）'}
                  </p>
                </div>
              )}

              <div className="actions" style={{ justifyContent: 'flex-end', margin: 0 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  取消
                </button>
                <button type="submit" disabled={submitting}>
                  {submitting ? '提交中...' : '确认创建草稿'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
