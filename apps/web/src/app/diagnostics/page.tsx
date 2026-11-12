import Link from 'next/link';
import { HealthCheck } from '../health-check';

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
        <p>本页不是 MVP，也不是核心产品 UI。</p>
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
          组织控制台开发入口
        </h2>
        <p style={{ color: 'var(--aven-color-foreground-secondary)' }}>
          此入口使用开发组织 ID，访问需要有效会话和相应组织权限。页面与双端设计评审尚未完成。
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
            <dd>已有组织主页、机会管理、成员列表与收件箱占位；正式设计评审仍待完成。</dd>
          </div>
          <div>
            <dt>API 与 Worker</dt>
            <dd>已有组织 Agent、机会接口及强制 RLS；真实模型和完整产品验收仍待完成。</dd>
          </div>
          <div>
            <dt>匹配与日程</dt>
            <dd>确定性匹配和日程求交已有后端实现；语义召回、真实 AI 与移动推送尚未实现。</dd>
          </div>
        </dl>
      </section>
      <footer>AVEN · M4 组织控制台与机会生命周期</footer>
    </main>
  );
}
