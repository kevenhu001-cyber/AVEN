import Link from 'next/link';
import { HealthCheck } from '../health-check';
import '../../components/shell/shell.css';
import '../../features/personal/personal.css';

export default function DiagnosticsPage() {
  return (
    <main className="aven-theme-halo personal-app diagnostics-page">
      <div className="page">
        <header className="page-head">
          <div>
            <p className="org-eyebrow">工程诊断</p>
            <h1>从可靠的连接开始。</h1>
            <p>
              Web、原生移动端与独立 API
              在同一套契约下运行。本页只验证工程联通，不展示虚构机会或用户数据。
            </p>
          </div>
          <div className="page-actions">
            <Link className="shell-link-button" href="/">
              返回 AVEN
            </Link>
          </div>
        </header>
        <p className="muted">本页不是 MVP，也不是核心产品 UI。</p>
        <HealthCheck />
        <section className="panel" aria-labelledby="org-console-title">
          <div className="panel-head">
            <div>
              <h2 id="org-console-title">组织控制台开发入口</h2>
              <p>
                此入口使用开发组织 ID，访问需要有效会话和相应组织权限。页面与双端设计评审尚未完成。
              </p>
            </div>
            <Link
              className="shell-link-button"
              href="/organizations/33333333-3333-4333-8333-333333333331"
            >
              打开组织控制台
            </Link>
          </div>
        </section>
        <section className="panel" aria-labelledby="scope-title">
          <div className="panel-head">
            <h2 id="scope-title">本阶段的边界</h2>
          </div>
          <dl>
            <div>
              <dt>Web 控制台</dt>
              <dd>
                组织主页、机会管理、成员列表与组织收件箱已完整就绪；遵循严苛的数据安全与权限隔离。
              </dd>
            </div>
            <div>
              <dt>API 与 Worker</dt>
              <dd>组织 Agent、机会接口及强制 RLS；支持多模型后端与受控执行沙箱。</dd>
            </div>
            <div>
              <dt>匹配与日程</dt>
              <dd>确定性意向匹配和日程求交支持；已接入语义推荐、模型对齐与跨端协同流转。</dd>
            </div>
          </dl>
        </section>
        <footer className="muted">AVEN · 工程诊断</footer>
      </div>
    </main>
  );
}
