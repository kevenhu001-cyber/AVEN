import type { PropsWithChildren, ReactNode } from 'react';
import { Mascot } from './mascot';

export function AuthShell({
  title,
  description,
  children,
}: PropsWithChildren<{
  title: string;
  description?: ReactNode;
}>) {
  return (
    <main className="auth-screen personal-app">
      <header className="auth-masthead">
        <span className="auth-wordmark">AVEN</span>
        <span className="auth-tagline">对话，让连接发生</span>
      </header>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-heading">
          <div className="auth-emblem">
            <Mascot large state="static" />
          </div>
          <h1 id="auth-title">{title}</h1>
          {description && <p className="auth-description">{description}</p>}
        </div>
        {children}
      </section>
      <footer className="auth-footer">开发验证版 · AI 使用 Mock 服务</footer>
    </main>
  );
}
