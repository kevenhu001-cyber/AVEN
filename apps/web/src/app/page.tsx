import Link from 'next/link';
import { HealthCheck } from './health-check';

export default function FoundationPage() {
  return (
    <main className="workspace">
      <header className="masthead">
        <span className="brand">AVEN</span>
        <span className="stage">M0 · 工程骨架</span>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">基础连接，而非功能演示</p>
        <h1 id="page-title">从可靠的连接开始。</h1>
        <p className="description">
          Web、原生移动端与独立 API
          正在同一套契约下建立。当前页面用于检查工程联通，不展示虚构机会或用户数据。
        </p>
      </section>
      <HealthCheck />
      <section
        className="connection"
        style={{
          marginTop: 'var(--aven-space-24)',
          borderLeft: '4px solid var(--aven-color-accent)',
        }}
        aria-labelledby="org-console-title"
      >
        <p className="eyebrow" style={{ color: 'var(--aven-color-accent)' }}>
          M4 · 组织与机会控制台
        </p>
        <h2 id="org-console-title" style={{ fontSize: 'var(--aven-font-size-h3)' }}>
          组织工作台已就绪
        </h2>
        <p style={{ color: 'var(--aven-color-foreground-secondary)' }}>
          进入实验室/企业组织控制台，体验概览指标、机会生命周期管理（草稿/开放/暂停/关闭）、成员权限与组织
          Agent 协同。
        </p>
        <div className="actions" style={{ margin: 'var(--aven-space-16) 0 0' }}>
          <Link
            href="/organizations/33333333-3333-4333-8333-333333333331"
            style={{ textDecoration: 'none' }}
          >
            <button type="button">打开组织控制台 ↗</button>
          </Link>
        </div>
      </section>
      <section className="scope" aria-labelledby="scope-title">
        <h2 id="scope-title">本阶段的边界</h2>
        <dl>
          <div>
            <dt>Web 控制台</dt>
            <dd>组织主页、机会管理、成员列表与收件箱占位，严格遵守设计令牌与状态矩阵。</dd>
          </div>
          <div>
            <dt>API 与 Worker</dt>
            <dd>组织 Agent 与机会动作已闭环；RLS 强制保障多租户与私人记忆隔离。</dd>
          </div>
          <div>
            <dt>M5 展望</dt>
            <dd>双向意愿对齐、可信引荐投递与学术导师协同评审。</dd>
          </div>
        </dl>
      </section>
      <footer>AVEN · M4 组织控制台与机会生命周期</footer>
    </main>
  );
}
