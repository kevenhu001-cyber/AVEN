'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { MeResponse } from '@aven/contracts';
import { AppShell } from '@/components/shell/app-shell';
import { api } from './api';
import './personal.css';

/**
 * Shell for pages that must stay reachable without a session (plugin directory,
 * connector authorization, admin, organization console, diagnostics). It reads
 * the session opportunistically and never blocks the page on it.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.auth
      .me(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setMe(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMe(null);
      });
    return () => controller.abort();
  }, []);

  return (
    <AppShell me={me} variant="platform">
      {children}
    </AppShell>
  );
}
