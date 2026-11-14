'use client';

import { useId, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { StateView } from '../../state-view';
import { Icon } from '@/features/personal/icon';

type InboxCategory = 'all' | 'application' | 'referral' | 'collaboration';
type ItemStatus = 'pending' | 'reviewing' | 'accepted' | 'archived';

interface InboxItem {
  id: string;
  category: 'application' | 'referral' | 'collaboration';
  status: ItemStatus;
  unread: boolean;
  applicantName: string;
  affiliation: string;
  opportunityTitle?: string;
  opportunityId?: string;
  avatarText: string;
  receivedAt: string;
  matchScore: number;
  statement: string;
  skills: string[];
  verificationNote: string;
  referralSigner?: string;
  email: string;
  replyHistory?: Array<{
    sender: string;
    text: string;
    sentAt: string;
  }>;
}

const INITIAL_INBOX_ITEMS: InboxItem[] = [
  {
    id: 'inbox-1',
    category: 'application',
    status: 'pending',
    unread: true,
    applicantName: '陈子涵',
    affiliation: '清华大学 · 交叉信息研究院 硕士生',
    opportunityTitle: '具身机器人移动与操作算法实习生',
    opportunityId: 'opp-1',
    avatarText: '子涵',
    receivedAt: '2026-11-13T14:32:00Z',
    matchScore: 96,
    statement:
      '我的主要研究方向为基于扩散模型与强化学习的多任务末端轨迹生成。已在 Isaac Gym / MuJoCo 仿真平台构建完整的 Sim-to-Real 标定工作流，曾获得 CoRL 2025 论文接收。期待加入团队共同攻坚复杂抓取与精细操作场景。',
    skills: ['Sim-to-Real', '强化学习', 'PyTorch', 'Isaac Gym', '扩散模型', 'CoRL 论文'],
    verificationNote: '高校数字身份认证已核验 · 证书指纹 e3b0c442...98fc',
    email: 'zihan.chen@mails.tsinghua.edu.cn',
    replyHistory: [],
  },
  {
    id: 'inbox-2',
    category: 'referral',
    status: 'pending',
    unread: true,
    applicantName: '林逸凡',
    affiliation: '浙江大学 · 控制科学与工程学院 博士生',
    opportunityTitle: '空间激光雷达 SLAM 博士后研究员',
    opportunityId: 'opp-2',
    avatarText: '逸凡',
    receivedAt: '2026-11-12T09:15:00Z',
    matchScore: 94,
    statement:
      '附上由智能系统与控制研究所王跃副教授签发的可信引荐信。研究专长为退化场景多传感器紧耦合融合建图（LiDAR-Inertial-Visual），主导开源项目在工业级矿井巡检机器人中平稳落地。',
    skills: ['LiDAR SLAM', '因子图优化', 'C++ 20', 'ROS 2', '多源融合', '嵌入式部署'],
    verificationNote: '学术导师可信引荐证书 · 密码学防伪签名已验证',
    referralSigner: '王跃 副教授（浙江大学控制学院）',
    email: 'yifan.lin@zju.edu.cn',
    replyHistory: [],
  },
  {
    id: 'inbox-3',
    category: 'collaboration',
    status: 'reviewing',
    unread: false,
    applicantName: '赵若楠',
    affiliation: '上海交通大学 · 自动化系特聘副研究员',
    avatarText: '若楠',
    receivedAt: '2026-11-11T16:40:00Z',
    matchScore: 89,
    statement:
      '我们实验室近期在极端受限空间无人机集群自主导航方向获批国家重点研发项目，获知贵团队在无人巡检软硬件架构上的深度积累，特致信探讨联合测试床构建及跨校区联合实习生培育。',
    skills: ['集群协同', '轨迹规划', '分布式控制', '重点实验室合作'],
    verificationNote: '校区组织互认协议已签署 · 经 AVEN 机构认证网关',
    email: 'ruonan.zhao@sjtu.edu.cn',
    replyHistory: [
      {
        sender: '组织管理员',
        text: '感谢来信。我们已将合作提议同步至技术委员会，预计本周五前完成初审。',
        sentAt: '2026-11-12T10:00:00Z',
      },
    ],
  },
  {
    id: 'inbox-4',
    category: 'application',
    status: 'accepted',
    unread: false,
    applicantName: '高梓墨',
    affiliation: '哈尔滨工业大学 · 航天学院 研三',
    opportunityTitle: '智能自主无人巡检系统科研助理',
    opportunityId: 'opp-3',
    avatarText: '梓墨',
    receivedAt: '2026-11-08T11:20:00Z',
    matchScore: 91,
    statement:
      '长期负责高压输电野外巡检无人机的飞控算法与故障容错，具备丰富的高原与极寒野外试验经验。已取得保密资质审查并熟悉工业现场实测规范。',
    skills: ['自主巡检', '飞控软硬件', 'PX4/ArduPilot', 'CAN总线', '野外测试'],
    verificationNote: '高校科研保密与学术资质核验通过',
    email: 'zimo.gao@hit.edu.cn',
    replyHistory: [
      {
        sender: '组织管理员',
        text: '欢迎加入！已为您生成受控研发工作空间访问令牌。',
        sentAt: '2026-11-09T15:30:00Z',
      },
    ],
  },
  {
    id: 'inbox-5',
    category: 'referral',
    status: 'archived',
    unread: false,
    applicantName: '苏承佑',
    affiliation: '香港科技大学（广州） · 机器人与自主系统 博士生',
    opportunityTitle: '具身机器人移动与操作算法实习生',
    opportunityId: 'opp-1',
    avatarText: '承佑',
    receivedAt: '2026-10-30T18:05:00Z',
    matchScore: 88,
    statement:
      '由粤港澳大湾区智能机器人联合实验室推荐。擅长触觉感知与机械臂阻抗控制。已完成上学期联合课题，档案归档备查。',
    skills: ['触觉传感', '阻抗控制', 'Force Control', 'Isaac Sim'],
    verificationNote: '联合实验室引荐归档',
    referralSigner: '刘建平 讲席教授',
    email: 'chengyou.su@hkust-gz.edu.cn',
    replyHistory: [],
  },
];

export default function OrganizationInboxPage() {
  const params = useParams<{ id: string }>();
  const orgId = params?.id ?? '';
  const searchInputId = useId();

  const [items, setItems] = useState<InboxItem[]>(INITIAL_INBOX_ITEMS);
  const [categoryFilter, setCategoryFilter] = useState<InboxCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ItemStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [replyText, setReplyText] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const inName = item.applicantName.toLowerCase().includes(query);
        const inAffiliation = item.affiliation.toLowerCase().includes(query);
        const inOpp = (item.opportunityTitle ?? '').toLowerCase().includes(query);
        const inSkills = item.skills.some((s) => s.toLowerCase().includes(query));
        const inStatement = item.statement.toLowerCase().includes(query);
        if (!inName && !inAffiliation && !inOpp && !inSkills && !inStatement) {
          return false;
        }
      }
      return true;
    });
  }, [items, categoryFilter, statusFilter, searchQuery]);

  const stats = useMemo(() => {
    const pendingCount = items.filter((i) => i.status === 'pending').length;
    const reviewingCount = items.filter((i) => i.status === 'reviewing').length;
    const referralCount = items.filter((i) => i.category === 'referral').length;
    const unreadCount = items.filter((i) => i.unread).length;
    return { pendingCount, reviewingCount, referralCount, unreadCount };
  }, [items]);

  const handleSelectItem = (item: InboxItem) => {
    setSelectedItem(item);
    if (item.unread) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, unread: false } : i)),
      );
    }
  };

  const handleUpdateStatus = (id: string, newStatus: ItemStatus, noticeText: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: newStatus, unread: false } : i)),
    );
    if (selectedItem?.id === id) {
      setSelectedItem((curr) => (curr ? { ...curr, status: newStatus, unread: false } : null));
    }
    setActionNotice(noticeText);
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !replyText.trim()) return;

    const newReply = {
      sender: '组织管理员',
      text: replyText.trim(),
      sentAt: new Date().toISOString(),
    };

    setItems((prev) =>
      prev.map((i) => {
        if (i.id === selectedItem.id) {
          return {
            ...i,
            status: i.status === 'pending' ? 'reviewing' : i.status,
            replyHistory: [...(i.replyHistory ?? []), newReply],
          };
        }
        return i;
      }),
    );

    setSelectedItem((curr) =>
      curr
        ? {
            ...curr,
            status: curr.status === 'pending' ? 'reviewing' : curr.status,
            replyHistory: [...(curr.replyHistory ?? []), newReply],
          }
        : null,
    );

    setReplyText('');
    setActionNotice(`回复已送达至候选人 ${selectedItem.applicantName} 的 AVEN 协同收件箱。`);
  };

  const handleMarkAllRead = () => {
    setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
    setActionNotice('所有信件已标记为已读。');
  };

  const getStatusBadge = (status: ItemStatus) => {
    switch (status) {
      case 'pending':
        return {
          label: '待审阅',
          color: 'var(--aven-color-accent)',
          background: 'rgba(59, 130, 246, 0.08)',
        };
      case 'reviewing':
        return {
          label: '深入沟通中',
          color: '#8b5cf6',
          background: 'rgba(139, 92, 246, 0.08)',
        };
      case 'accepted':
        return {
          label: '已通过意向',
          color: 'var(--aven-color-success)',
          background: 'var(--aven-color-success-surface)',
        };
      case 'archived':
        return {
          label: '已归档',
          color: 'var(--aven-color-foreground-secondary)',
          background: 'var(--aven-color-surface-secondary)',
        };
    }
  };

  const getCategoryLabel = (category: InboxItem['category']) => {
    switch (category) {
      case 'application':
        return '机会申请';
      case 'referral':
        return '导师引荐';
      case 'collaboration':
        return '学术协作';
    }
  };

  return (
    <section aria-labelledby="inbox-heading" style={{ maxWidth: '1080px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--aven-space-16)',
          marginBottom: 'var(--aven-space-24)',
        }}
      >
        <div>
          <h1 id="inbox-heading" style={{ margin: 0, fontSize: 'var(--aven-font-size-h2)' }}>
            组织收件箱
          </h1>
          <p className="eyebrow" style={{ marginTop: 'var(--aven-space-4)' }}>
            处理科研机会申请、学术导师引荐信与校区跨机构协作信件
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--aven-space-8)' }}>
          {stats.unreadCount > 0 && (
            <button
              type="button"
              className="secondary"
              onClick={handleMarkAllRead}
              style={{
                minHeight: '36px',
                padding: '0 var(--aven-space-16)',
                borderRadius: '9999px',
                fontSize: 'var(--aven-font-size-body-sm)',
              }}
            >
              标记全部已读 ({stats.unreadCount})
            </button>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--aven-space-16)',
          marginBottom: 'var(--aven-space-24)',
        }}
      >
        <div
          style={{
            padding: 'var(--aven-space-16)',
            borderRadius: 'var(--aven-radius-lg)',
            border: '1px solid var(--aven-color-border)',
            backgroundColor: 'var(--aven-color-surface-primary)',
          }}
        >
          <div style={{ fontSize: 'var(--aven-font-size-body-sm)', color: 'var(--aven-color-foreground-secondary)' }}>
            待审阅投递
          </div>
          <div style={{ fontSize: '28px', fontWeight: 600, marginTop: 'var(--aven-space-4)', color: 'var(--aven-color-accent)' }}>
            {stats.pendingCount}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--aven-color-foreground-secondary)', marginTop: 'var(--aven-space-4)' }}>
            需优先确认与回复
          </div>
        </div>

        <div
          style={{
            padding: 'var(--aven-space-16)',
            borderRadius: 'var(--aven-radius-lg)',
            border: '1px solid var(--aven-color-border)',
            backgroundColor: 'var(--aven-color-surface-primary)',
          }}
        >
          <div style={{ fontSize: 'var(--aven-font-size-body-sm)', color: 'var(--aven-color-foreground-secondary)' }}>
            沟通协同中
          </div>
          <div style={{ fontSize: '28px', fontWeight: 600, marginTop: 'var(--aven-space-4)' }}>
            {stats.reviewingCount}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--aven-color-foreground-secondary)', marginTop: 'var(--aven-space-4)' }}>
            已建立意向通道
          </div>
        </div>

        <div
          style={{
            padding: 'var(--aven-space-16)',
            borderRadius: 'var(--aven-radius-lg)',
            border: '1px solid var(--aven-color-border)',
            backgroundColor: 'var(--aven-color-surface-primary)',
          }}
        >
          <div style={{ fontSize: 'var(--aven-font-size-body-sm)', color: 'var(--aven-color-foreground-secondary)' }}>
            导师可信引荐
          </div>
          <div style={{ fontSize: '28px', fontWeight: 600, marginTop: 'var(--aven-space-4)' }}>
            {stats.referralCount}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--aven-color-foreground-secondary)', marginTop: 'var(--aven-space-4)' }}>
            带加密防伪签名背书
          </div>
        </div>

        <div
          style={{
            padding: 'var(--aven-space-16)',
            borderRadius: 'var(--aven-radius-lg)',
            border: '1px solid var(--aven-color-border)',
            backgroundColor: 'var(--aven-color-surface-primary)',
          }}
        >
          <div style={{ fontSize: 'var(--aven-font-size-body-sm)', color: 'var(--aven-color-foreground-secondary)' }}>
            收件总计
          </div>
          <div style={{ fontSize: '28px', fontWeight: 600, marginTop: 'var(--aven-space-4)' }}>
            {items.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--aven-color-foreground-secondary)', marginTop: 'var(--aven-space-4)' }}>
            已接入隐私隔离协议
          </div>
        </div>
      </div>

      {/* Action Notice */}
      {actionNotice && (
        <div
          className="connection"
          style={{
            backgroundColor: 'var(--aven-color-success-surface)',
            color: 'var(--aven-color-success)',
            padding: 'var(--aven-space-12) var(--aven-space-16)',
            borderRadius: 'var(--aven-radius-md)',
            marginBottom: 'var(--aven-space-16)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            aria-label="关闭提示"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'currentColor',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--aven-space-12)',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--aven-space-16)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--aven-space-8)', overflowX: 'auto', paddingBottom: '4px' }}>
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'application', label: '机会申请' },
              { key: 'referral', label: '导师引荐' },
              { key: 'collaboration', label: '学术协作' },
            ] as const
          ).map(({ key, label }) => {
            const isSelected = categoryFilter === key;
            return (
              <button
                key={key}
                type="button"
                className={isSelected ? '' : 'secondary'}
                onClick={() => setCategoryFilter(key)}
                style={{
                  minHeight: '34px',
                  padding: 'var(--aven-space-6) var(--aven-space-14)',
                  borderRadius: '9999px',
                  fontSize: 'var(--aven-font-size-body-sm)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 'var(--aven-space-8)', flex: 1, maxWidth: '380px' }}>
          <label htmlFor={searchInputId} className="sr-only">搜索申请人姓名、主题或技能关键词</label>
          <input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索申请人、主题或技能..."
            style={{
              width: '100%',
              minHeight: '36px',
              padding: '0 var(--aven-space-14)',
              borderRadius: '9999px',
              border: '1px solid var(--aven-color-border)',
              backgroundColor: 'var(--aven-color-surface-primary)',
              fontSize: 'var(--aven-font-size-body-sm)',
            }}
          />
        </div>
      </div>

      {/* Status Filter Sub-row */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--aven-space-8)',
          marginBottom: 'var(--aven-space-20)',
          fontSize: '13px',
          color: 'var(--aven-color-foreground-secondary)',
          alignItems: 'center',
        }}
      >
        <span>状态筛选：</span>
        {(
          [
            { key: 'all', label: '全部状态' },
            { key: 'pending', label: '待审阅' },
            { key: 'reviewing', label: '沟通中' },
            { key: 'accepted', label: '已录用意向' },
            { key: 'archived', label: '已归档' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            style={{
              background: 'none',
              border: 'none',
              padding: '2px 8px',
              cursor: 'pointer',
              borderRadius: '9999px',
              color: statusFilter === key ? 'var(--aven-color-primary)' : 'inherit',
              fontWeight: statusFilter === key ? 600 : 400,
              backgroundColor: statusFilter === key ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      {filteredItems.length === 0 ? (
        <StateView
          state="empty"
          emptyTitle="暂无符合条件的信件"
          emptyMessage="当前筛选条件或搜索关键词下没有找到匹配的投递与协作记录。"
          emptyAction={
            (categoryFilter !== 'all' || statusFilter !== 'all' || searchQuery) && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setCategoryFilter('all');
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
                style={{ borderRadius: '9999px' }}
              >
                重置筛选条件
              </button>
            )
          }
        >
          <div />
        </StateView>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--aven-space-12)' }}>
          {filteredItems.map((item) => {
            const statusInfo = getStatusBadge(item.status);
            return (
              <div
                key={item.id}
                onClick={() => handleSelectItem(item)}
                style={{
                  padding: 'var(--aven-space-16) var(--aven-space-20)',
                  borderRadius: 'var(--aven-radius-lg)',
                  border: item.unread
                    ? '1px solid var(--aven-color-accent)'
                    : '1px solid var(--aven-color-border)',
                  backgroundColor: 'var(--aven-color-surface-primary)',
                  boxShadow: item.unread ? '0 1px 4px rgba(59, 130, 246, 0.08)' : 'none',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s ease, background-color 0.15s ease',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 'var(--aven-space-12)',
                    marginBottom: 'var(--aven-space-8)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--aven-space-12)' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '9999px',
                        backgroundColor: 'var(--aven-color-surface-secondary)',
                        color: 'var(--aven-color-foreground-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: '13px',
                      }}
                    >
                      {item.avatarText}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--aven-space-8)' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--aven-font-size-body)' }}>
                          {item.applicantName}
                        </span>
                        {item.unread && (
                          <span
                            style={{
                              display: 'inline-block',
                              width: '7px',
                              height: '7px',
                              borderRadius: '9999px',
                              backgroundColor: 'var(--aven-color-accent)',
                            }}
                          />
                        )}
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '1px 8px',
                            borderRadius: '9999px',
                            border: '1px solid var(--aven-color-border)',
                            color: 'var(--aven-color-foreground-secondary)',
                          }}
                        >
                          {getCategoryLabel(item.category)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--aven-font-size-body-sm)',
                          color: 'var(--aven-color-foreground-secondary)',
                          marginTop: '2px',
                        }}
                      >
                        {item.affiliation}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--aven-space-12)' }}>
                    <span
                      style={{
                        fontSize: '12px',
                        padding: '3px 10px',
                        borderRadius: '9999px',
                        fontWeight: 500,
                        color: statusInfo.color,
                        backgroundColor: statusInfo.background,
                      }}
                    >
                      {statusInfo.label}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--aven-color-foreground-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(item.receivedAt).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                </div>

                {item.opportunityTitle && (
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--aven-color-primary)',
                      marginBottom: 'var(--aven-space-8)',
                      padding: '4px 10px',
                      borderRadius: 'var(--aven-radius-sm)',
                      backgroundColor: 'var(--aven-color-surface-secondary)',
                      display: 'inline-block',
                    }}
                  >
                    意向目标：{item.opportunityTitle}
                    <span style={{ marginLeft: '8px', color: 'var(--aven-color-success)' }}>
                      {item.matchScore}% 意向匹配
                    </span>
                  </div>
                )}

                <p
                  style={{
                    margin: '0 0 var(--aven-space-12) 0',
                    fontSize: 'var(--aven-font-size-body-sm)',
                    lineHeight: '1.6',
                    color: 'var(--aven-color-foreground-secondary)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {item.statement}
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'var(--aven-space-8)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {item.skills.map((skill) => (
                      <span
                        key={skill}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          backgroundColor: 'var(--aven-color-surface-secondary)',
                          color: 'var(--aven-color-foreground-secondary)',
                        }}
                      >
                        {skill}
                      </span>
                    ))}
                  </div>

                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--aven-color-foreground-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Icon name="verified" size={13} style={{ color: 'var(--aven-color-accent)' }} />
                    <span>{item.verificationNote}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Item Drawer / Modal */}
      {selectedItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-title"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: 'var(--aven-space-20)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedItem(null);
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--aven-color-surface-primary)',
              borderRadius: 'var(--aven-radius-xl)',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 'var(--aven-space-24)',
              border: '1px solid var(--aven-color-border)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 'var(--aven-space-16)',
                borderBottom: '1px solid var(--aven-color-border)',
                paddingBottom: 'var(--aven-space-16)',
              }}
            >
              <div style={{ display: 'flex', gap: 'var(--aven-space-16)', alignItems: 'center' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '9999px',
                    backgroundColor: 'var(--aven-color-surface-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: '16px',
                  }}
                >
                  {selectedItem.avatarText}
                </div>
                <div>
                  <h2 id="detail-title" style={{ margin: 0, fontSize: 'var(--aven-font-size-h3)' }}>
                    {selectedItem.applicantName}
                  </h2>
                  <div
                    style={{
                      fontSize: 'var(--aven-font-size-body-sm)',
                      color: 'var(--aven-color-foreground-secondary)',
                      marginTop: '2px',
                    }}
                  >
                    {selectedItem.affiliation} · {selectedItem.email}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                aria-label="关闭详情"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--aven-color-foreground-secondary)',
                  padding: '6px',
                  borderRadius: '9999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Target & Verification Info */}
            <div
              style={{
                padding: 'var(--aven-space-12) var(--aven-space-16)',
                borderRadius: 'var(--aven-radius-md)',
                backgroundColor: 'var(--aven-color-surface-secondary)',
                marginBottom: 'var(--aven-space-20)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 'var(--aven-space-8)',
              }}
            >
              <div>
                <span style={{ fontSize: '12px', color: 'var(--aven-color-foreground-secondary)' }}>
                  申请类型：
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {getCategoryLabel(selectedItem.category)}
                </span>
                {selectedItem.opportunityTitle && (
                  <span style={{ marginLeft: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                    <Icon name="chevron" size={12} />
                    <span>{selectedItem.opportunityTitle}</span>
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--aven-color-success)', fontWeight: 500 }}>
                意向对齐度：{selectedItem.matchScore}%
              </div>
            </div>

            {/* Referral Signer if present */}
            {selectedItem.referralSigner && (
              <div
                style={{
                  padding: 'var(--aven-space-12) var(--aven-space-16)',
                  borderRadius: 'var(--aven-radius-md)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  backgroundColor: 'rgba(59, 130, 246, 0.04)',
                  marginBottom: 'var(--aven-space-20)',
                  fontSize: '13px',
                }}
              >
                <strong>引荐签署人：</strong> {selectedItem.referralSigner}
                <div style={{ fontSize: '12px', color: 'var(--aven-color-foreground-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Icon name="verified" size={13} style={{ color: 'var(--aven-color-accent)' }} />
                  <span>签署已通过跨机构数字身份体系确权，保证推荐内容真实可追溯</span>
                </div>
              </div>
            )}

            {/* Statement */}
            <div style={{ marginBottom: 'var(--aven-space-20)' }}>
              <div
                style={{
                  fontSize: 'var(--aven-font-size-body-sm)',
                  fontWeight: 600,
                  marginBottom: 'var(--aven-space-8)',
                }}
              >
                投递陈述与学术愿景
              </div>
              <p
                style={{
                  margin: 0,
                  lineHeight: '1.7',
                  fontSize: 'var(--aven-font-size-body-sm)',
                  color: 'var(--aven-color-foreground-primary)',
                  backgroundColor: 'var(--aven-color-surface-secondary)',
                  padding: 'var(--aven-space-14)',
                  borderRadius: 'var(--aven-radius-md)',
                }}
              >
                {selectedItem.statement}
              </p>
            </div>

            {/* Matched Memories & Skills */}
            <div style={{ marginBottom: 'var(--aven-space-24)' }}>
              <div
                style={{
                  fontSize: 'var(--aven-font-size-body-sm)',
                  fontWeight: 600,
                  marginBottom: 'var(--aven-space-8)',
                }}
              >
                代表性记忆专长与标签
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {selectedItem.skills.map((skill) => (
                  <span
                    key={skill}
                    style={{
                      fontSize: '12px',
                      padding: '4px 10px',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--aven-color-surface-secondary)',
                      color: 'var(--aven-color-foreground-primary)',
                      border: '1px solid var(--aven-color-border)',
                    }}
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Reply History */}
            {selectedItem.replyHistory && selectedItem.replyHistory.length > 0 && (
              <div style={{ marginBottom: 'var(--aven-space-20)' }}>
                <div
                  style={{
                    fontSize: 'var(--aven-font-size-body-sm)',
                    fontWeight: 600,
                    marginBottom: 'var(--aven-space-8)',
                  }}
                >
                  沟通历史
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedItem.replyHistory.map((reply, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--aven-radius-md)',
                        backgroundColor: 'var(--aven-color-surface-secondary)',
                        fontSize: '13px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: 'var(--aven-color-foreground-secondary)',
                          marginBottom: '4px',
                          fontSize: '11px',
                        }}
                      >
                        <span>{reply.sender}</span>
                        <span>{new Date(reply.sentAt).toLocaleString('zh-CN')}</span>
                      </div>
                      <div>{reply.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--aven-space-8)',
                marginBottom: 'var(--aven-space-20)',
                paddingTop: 'var(--aven-space-16)',
                borderTop: '1px solid var(--aven-color-border)',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  handleUpdateStatus(
                    selectedItem.id,
                    'accepted',
                    `已向 ${selectedItem.applicantName} 发送录用意向确认。`,
                  )
                }
                style={{
                  backgroundColor: 'var(--aven-color-success)',
                  color: '#fff',
                  borderRadius: '9999px',
                  border: 'none',
                  minHeight: '34px',
                  padding: '0 var(--aven-space-16)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Icon name="check" size={14} />
                <span>通过意向并录用</span>
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() =>
                  handleUpdateStatus(
                    selectedItem.id,
                    'reviewing',
                    `已标记 ${selectedItem.applicantName} 为深入沟通中。`,
                  )
                }
                style={{
                  borderRadius: '9999px',
                  minHeight: '34px',
                  padding: '0 var(--aven-space-16)',
                  fontSize: 'var(--aven-font-size-body-sm)',
                }}
              >
                深入沟通中
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() =>
                  handleUpdateStatus(
                    selectedItem.id,
                    'archived',
                    `已将 ${selectedItem.applicantName} 的信件归档。`,
                  )
                }
                style={{
                  borderRadius: '9999px',
                  minHeight: '34px',
                  padding: '0 var(--aven-space-16)',
                  fontSize: 'var(--aven-font-size-body-sm)',
                }}
              >
                归档信件
              </button>
            </div>

            {/* Reply Composer Form */}
            <form onSubmit={handleSendReply}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--aven-space-8)' }}>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`给 ${selectedItem.applicantName} 回复消息或预约面谈时间...`}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: 'var(--aven-space-12)',
                    borderRadius: 'var(--aven-radius-lg)',
                    border: '1px solid var(--aven-color-border)',
                    fontSize: 'var(--aven-font-size-body-sm)',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--aven-space-8)' }}>
                  <button
                    type="submit"
                    disabled={!replyText.trim()}
                    style={{
                      borderRadius: '9999px',
                      minHeight: '34px',
                      padding: '0 var(--aven-space-20)',
                      fontSize: 'var(--aven-font-size-body-sm)',
                      opacity: replyText.trim() ? 1 : 0.5,
                    }}
                  >
                    发送回复
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
