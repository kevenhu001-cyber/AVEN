'use client';
import { useCallback, useEffect, useState } from 'react';
import { AuthForm } from './auth-form';
import type { WorkspacePage } from './workspace-navigation';
import { Workspace } from './workspace';
import { usePersonalSession } from './use-personal-session';
import './personal.css';
import './workspace.css';

export function PersonalApp({ initialPage = 'chat' }: { initialPage?: WorkspacePage }) {
  const session = usePersonalSession();
  const [recoveryRoute, setRecoveryRoute] = useState(false);
  const openRecovery = useCallback(() => setRecoveryRoute(true), []);
  useEffect(() => {
    let active = true;
    const requested = new URLSearchParams(window.location.hash.slice(1)).has('reset_token');
    void Promise.resolve(requested).then((value) => {
      if (active && value) setRecoveryRoute(true);
    });
    const changed = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has('reset_token'))
        setRecoveryRoute(true);
    };
    window.addEventListener('hashchange', changed);
    return () => {
      active = false;
      window.removeEventListener('hashchange', changed);
    };
  }, []);
  if (session.me && !recoveryRoute)
    return (
      <Workspace
        key={session.me.user.id}
        me={session.me}
        initialPage={initialPage}
        suspended={session.status !== 'ready'}
        problem={session.problem}
        onRetry={() => void session.recheck(true)}
        onExpired={session.invalidate}
        onLogout={() => void session.logout()}
      />
    );
  // Keep this tree mounted during anonymous checks, including initial hydration.
  return (
    <AuthForm
      onLogin={session.signedIn}
      onRecoveryOpen={openRecovery}
      onRecoveryClose={() => setRecoveryRoute(false)}
      onReset={session.invalidate}
      checking={session.status === 'checking'}
      connectionProblem={session.problem}
      onRetry={() => void session.recheck()}
    />
  );
}
