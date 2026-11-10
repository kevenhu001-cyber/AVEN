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
      <section className="scope" aria-labelledby="scope-title">
        <h2 id="scope-title">本阶段的边界</h2>
        <dl>
          <div>
            <dt>Web 与原生</dt>
            <dd>分别实现界面，共享契约、传输客户端与设计令牌。</dd>
          </div>
          <div>
            <dt>API 与 Worker</dt>
            <dd>只有工程探针；就绪检查保持 503，直到依赖与消费器经过真实验证。</dd>
          </div>
          <div>
            <dt>业务与智能</dt>
            <dd>账号、机会、授权、数据库和 AI 尚未开放。本页不是 MVP，也不是核心产品 UI。</dd>
          </div>
        </dl>
      </section>
      <footer>AVEN · 开发骨架 · 不含真实或 Mock AI 能力</footer>
    </main>
  );
}
