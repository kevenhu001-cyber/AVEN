'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AgentRuntime } from '@aven/contracts';
import { api, authExpired, webCall } from './api';
export function useAgentRuntime(suspended: boolean, onExpired: () => void) {
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [lastSuspended, setLastSuspended] = useState(suspended);
  if (lastSuspended !== suspended) {
    setLastSuspended(suspended);
    setRuntime(null);
    setError(false);
  }
  const retry = useCallback(() => {
    setRuntime(null);
    setError(false);
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (suspended) return;
    const controller = new AbortController();
    void api.agent
      .runtime(webCall(controller.signal))
      .then((value) => {
        if (!controller.signal.aborted) setRuntime(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (authExpired(cause)) onExpired();
          else setError(true);
        }
      });
    return () => controller.abort();
  }, [revision, suspended, onExpired]);
  return { runtime, error, retry };
}
