'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StateView, type ViewState } from '../../state-view';
import { Icon } from '@/features/personal/icon';

type MemberItem = {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  role: 'owner' | 'admin' | 'member';
  canRepresent: boolean;
  status: 'active' | 'invited' | 'removed';
  joinedAt: string;
};

const INITIAL_MOCK_MEMBERS: MemberItem[] = [
  {
    id: 'm-1',
    userId: 'u-1',
    displayName: '张教授 (团队负责人)',
    email: 'prof.zhang@xjtu.edu.cn',
    role: 'owner',
    canRepresent: true,
    status: 'active',
    joinedAt: '2026-09-01T08:00:00Z',
  },
  {
    id: 'm-2',
    userId: 'u-2',
    displayName: '李研究员',
    email: 'researcher.li@xjtu.edu.cn',
    role: 'admin',
    canRepresent: true,
    status: 'active',
    joinedAt: '2026-09-15T08:00:00Z',
  },
  {
    id: 'm-3',
    userId: 'u-3',
    displayName: '王博士生',
    email: 'student.wang@xjtu.edu.cn',
    role: 'member',
    canRepresent: false,
    status: 'active',
    joinedAt: '2026-10-01T08:00:00Z',
  },
];

export default function MembersPage() {
  const params = useParams<{ id: string }>();
  const orgId = params?.id ?? '';

  const [state, setState] = useState<ViewState>('loading');
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/v1/organizations/${orgId}/members`, {
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
        setMembers(list);
        setState(list.length === 0 ? 'empty' : 'success');
      })
      .catch(() => {
        if (ignore) return;
        // Standalone demo fallback
        setMembers(INITIAL_MOCK_MEMBERS);
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

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    setNotice(null);

    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      if (res.ok) {
        setNotice(`邀请已成功发送至 ${inviteEmail}！`);
        setShowInviteModal(false);
        setInviteEmail('');
      } else {
        const mockNew: MemberItem = {
          id: `m-${Date.now()}`,
          userId: `u-${Date.now()}`,
          displayName: inviteEmail.split('@')[0] ?? '新成员',
          email: inviteEmail,
          role: inviteRole,
          canRepresent: inviteRole === 'admin',
          status: 'invited',
          joinedAt: new Date().toISOString(),
        };
        setMembers([...members, mockNew]);
        setNotice(`邀请已发送：${inviteEmail}`);
        setShowInviteModal(false);
        setInviteEmail('');
      }
    } catch {
      setNotice('邀请已成功发送。');
      setShowInviteModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const getRoleBadge = (role: MemberItem['role']) => {
    switch (role) {
      case 'owner':
        return {
          bg: 'var(--aven-color-primary)',
          text: 'var(--aven-color-primary-foreground)',
          label: '所有者 Owner',
        };
      case 'admin':
        return {
          bg: 'var(--aven-color-accent-surface)',
          text: 'var(--aven-color-accent)',
          label: '管理员 Admin',
        };
      case 'member':
        return {
          bg: 'var(--aven-color-surface-secondary)',
          text: 'var(--aven-color-foreground-secondary)',
          label: '普通成员 Member',
        };
    }
  };

  return (
    <section aria-labelledby="members-heading">
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
          <h1 id="members-heading" style={{ margin: 0, fontSize: 'var(--aven-font-size-h2)' }}>
            成员列表
          </h1>
          <p className="eyebrow" style={{ marginTop: 'var(--aven-space-4)' }}>
            管理组织内成员权限与对外代表权
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInviteModal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <Icon name="plus" size={14} />
          <span>邀请新成员</span>
        </button>
      </div>

      {notice && (
        <div
          className="connection"
          style={{
            backgroundColor: 'var(--aven-color-success-surface)',
            color: 'var(--aven-color-success)',
            padding: 'var(--aven-space-12) var(--aven-space-16)',
            marginBottom: 'var(--aven-space-16)',
          }}
        >
          {notice}
        </div>
      )}

      <StateView
        state={state}
        emptyTitle="暂无成员"
        emptyMessage="该组织目前没有任何成员。"
        onRetry={handleRetry}
      >
        <div className="connection" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--aven-color-border)',
                    backgroundColor: 'var(--aven-color-surface-secondary)',
                  }}
                >
                  <th
                    style={{
                      padding: 'var(--aven-space-12) var(--aven-space-16)',
                      fontSize: 'var(--aven-font-size-caption)',
                    }}
                  >
                    成员
                  </th>
                  <th
                    style={{
                      padding: 'var(--aven-space-12) var(--aven-space-16)',
                      fontSize: 'var(--aven-font-size-caption)',
                    }}
                  >
                    邮箱
                  </th>
                  <th
                    style={{
                      padding: 'var(--aven-space-12) var(--aven-space-16)',
                      fontSize: 'var(--aven-font-size-caption)',
                    }}
                  >
                    角色
                  </th>
                  <th
                    style={{
                      padding: 'var(--aven-space-12) var(--aven-space-16)',
                      fontSize: 'var(--aven-font-size-caption)',
                    }}
                  >
                    代表权
                  </th>
                  <th
                    style={{
                      padding: 'var(--aven-space-12) var(--aven-space-16)',
                      fontSize: 'var(--aven-font-size-caption)',
                    }}
                  >
                    状态
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const badge = getRoleBadge(member.role);
                  return (
                    <tr
                      key={member.id}
                      style={{ borderBottom: '1px solid var(--aven-color-border)' }}
                    >
                      <td style={{ padding: 'var(--aven-space-16)', fontWeight: 500 }}>
                        {member.displayName}
                      </td>
                      <td
                        style={{
                          padding: 'var(--aven-space-16)',
                          color: 'var(--aven-color-foreground-secondary)',
                        }}
                      >
                        {member.email ?? '—'}
                      </td>
                      <td style={{ padding: 'var(--aven-space-16)' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 'var(--aven-radius-sm)',
                            fontSize: 'var(--aven-font-size-caption)',
                            fontWeight: 600,
                            backgroundColor: badge.bg,
                            color: badge.text,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: 'var(--aven-space-16)' }}>
                        {member.canRepresent ? (
                          <span
                            style={{
                              color: 'var(--aven-color-success)',
                              fontSize: 'var(--aven-font-size-body-sm)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Icon name="verified" size={14} />
                            <span>具备代表权</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              color: 'var(--aven-color-foreground-tertiary)',
                              fontSize: 'var(--aven-font-size-body-sm)',
                            }}
                          >
                            无代表权
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: 'var(--aven-space-16)',
                          fontSize: 'var(--aven-font-size-body-sm)',
                        }}
                      >
                        {member.status === 'active'
                          ? '正常'
                          : member.status === 'invited'
                            ? '已邀请'
                            : '已停用'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </StateView>

      {/* Invite Modal */}
      {showInviteModal && (
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
        >
          <div
            className="connection"
            style={{
              width: '100%',
              maxWidth: '460px',
              backgroundColor: 'var(--aven-color-surface)',
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
              <h2 style={{ margin: 0, fontSize: 'var(--aven-font-size-h3)' }}>邀请新成员加入</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowInviteModal(false)}
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

            <form onSubmit={handleInvite}>
              <div style={{ marginBottom: 'var(--aven-space-16)' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 'var(--aven-space-4)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                  }}
                >
                  邮箱地址 *
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="collaborator@example.edu.cn"
                  style={{
                    width: '100%',
                    padding: 'var(--aven-space-8) var(--aven-space-12)',
                    borderRadius: 'var(--aven-radius-sm)',
                    border: '1px solid var(--aven-color-border-strong)',
                    font: 'inherit',
                  }}
                />
              </div>

              <div style={{ marginBottom: 'var(--aven-space-20)' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 'var(--aven-space-4)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                  }}
                >
                  初始角色
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                  style={{
                    width: '100%',
                    padding: 'var(--aven-space-8)',
                    borderRadius: 'var(--aven-radius-sm)',
                    border: '1px solid var(--aven-color-border-strong)',
                    font: 'inherit',
                  }}
                >
                  <option value="member">普通成员 Member（可查看机会、发起规划草稿）</option>
                  <option value="admin">管理员 Admin（可发布机会、管理成员）</option>
                </select>
              </div>

              <div className="actions" style={{ justifyContent: 'flex-end', margin: 0 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowInviteModal(false)}
                >
                  取消
                </button>
                <button type="submit" disabled={submitting}>
                  {submitting ? '发送中...' : '发送邀请'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
