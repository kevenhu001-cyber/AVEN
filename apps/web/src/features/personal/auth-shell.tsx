import type { PropsWithChildren, ReactNode } from 'react';
export function AuthShell({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: ReactNode }>) {
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-heading">
        <div className="auth-panel-brand" aria-hidden="true">
          AVEN
        </div>
        <h1 id="auth-title">{title}</h1>
        {description && <p className="auth-description">{description}</p>}
      </div>
      {children}
    </section>
  );
}
