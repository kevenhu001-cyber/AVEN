'use client';

import { StateView } from '../../state-view';

export default function OrganizationInboxPage() {
  return (
    <section aria-labelledby="inbox-heading">
      <div style={{ marginBottom: 'var(--aven-space-24)' }}>
        <h1 id="inbox-heading" style={{ margin: 0, fontSize: 'var(--aven-font-size-h2)' }}>
          组织收件箱
        </h1>
        <p className="eyebrow" style={{ marginTop: 'var(--aven-space-4)' }}>
          处理机会申请、引荐投递与学术协作私信
        </p>
      </div>

      <StateView
        state="empty"
        emptyTitle="收件箱暂未开放"
        emptyMessage="当前阶段为 M4（组织主页与机会生命周期）。双向机会申请、引荐信件流转与组织间智能对话将在 M5 里程碑中正式上线。"
      >
        <div />
      </StateView>

      <div
        className="connection"
        style={{
          marginTop: 'var(--aven-space-32)',
          borderLeft: '4px solid var(--aven-color-accent)',
        }}
      >
        <p className="eyebrow" style={{ color: 'var(--aven-color-accent)' }}>
          后续能力演进 · M5 阶段
        </p>
        <ul
          style={{
            margin: 0,
            paddingLeft: 'var(--aven-space-20)',
            color: 'var(--aven-color-foreground-secondary)',
          }}
        >
          <li style={{ marginBottom: 'var(--aven-space-8)' }}>
            <strong>结构化申请审查</strong>
            ：学生经过双向意愿对齐后发起投递，附带精选个人记忆（技能、经历证书与代表作）。
          </li>
          <li style={{ marginBottom: 'var(--aven-space-8)' }}>
            <strong>可验证引荐流转</strong>
            ：由校区导师或合作者签发的密码学防伪引荐信，直达组织管理收件箱。
          </li>
          <li>
            <strong>团队协同评阅</strong>：组织内部多位导师或学生共同批注，全程遵守数据隔离协议。
          </li>
        </ul>
      </div>
    </section>
  );
}
