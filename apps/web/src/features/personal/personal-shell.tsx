'use client';

import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/shell/app-shell';
import { AppStateProvider } from './app-state';
import { AuthForm } from './auth-form';
import { Mascot } from './mascot';
import { SessionProvider, useSession } from './session';
import './personal.css';

/** Auth gate + shared shell for every personal Web route. */
export function PersonalShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { me, status, problem, suspended, recheck } = useSession();

  if (me)
    return (
      <AppStateProvider>
        <AppShell me={me}>{children}</AppShell>
        {suspended && (
          <section className="session-cover halo-cover" aria-label="会话校验">
            <Mascot size={96} state="thinking" />
            <h1>先确认一下当前会话</h1>
            <p role="status">{problem || '正在重新验证，私人内容暂时隐藏。'}</p>
            <Button onClick={() => void recheck()}>重新验证会话</Button>
          </section>
        )}
      </AppStateProvider>
    );

  if (status !== 'ready')
    return (
      <main className="personal-app aven-theme-halo auth-screen">
        <section className="auth-card flex flex-col items-center gap-4">
          <Mascot large state="thinking" />
          <h1>{status === 'checking' ? '正在验证会话' : '暂时无法连接'}</h1>
          {problem && <Alert variant="warning">{problem}</Alert>}
          {status === 'error' && <Button onClick={() => void recheck()}>重新连接</Button>}
        </section>
      </main>
    );

  return <AuthForm onLogin={recheck} />;
}
