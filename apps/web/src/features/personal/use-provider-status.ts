'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIProviderStatus } from '@aven/contracts';
import { api, authExpired, webCall } from './api';

export function useProviderStatus(enabled = true) {
  const [status, setStatus] = useState<AIProviderStatus | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    return api.agent
      .providerStatus(webCall(abort.signal))
      .then((result) => {
        if (!abort.signal.aborted) {
          setStatus(result);
          setError('');
        }
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        // Informational only: an expired session is handled by the session gate,
        // so this probe never logs the user out on its own.
        if (authExpired(cause)) setStatus(null);
        else setError('模型状态暂时不可用。');
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => controller.current?.abort();
  }, [enabled, load]);

  return { status, error, reload: load };
}
