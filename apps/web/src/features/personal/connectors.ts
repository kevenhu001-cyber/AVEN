'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { webCall } from './api';

/** Real third-party services exposed by the Open Connector gateway. */
export const connectorServices = {
  gmail: 'Gmail',
  googledrive: 'Google Drive',
  github: 'GitHub',
  googlecalendar: 'Google Calendar',
  outlook: 'Outlook',
} as const;

export type ConnectorService = keyof typeof connectorServices;
export type ConnectorStatus = 'pending' | 'connected' | 'failed' | 'expired' | 'cancelled';

export const ConnectorRowSchema = z.object({
  service: z.string(),
  status: z.string(),
});
export type ConnectorRow = z.infer<typeof ConnectorRowSchema>;

const ConnectResponseSchema = z.object({
  authorizationUrl: z.url(),
  expiresAt: z.iso.datetime(),
});

/** Maps a plugin id (e.g. `gmail.mail`) to a real gateway service, if one exists. */
export function connectorServiceFor(pluginId: string): ConnectorService | null {
  const prefix = pluginId.split('.')[0];
  return prefix && prefix in connectorServices ? (prefix as ConnectorService) : null;
}

export function connectorServiceLabel(service: string): string {
  return connectorServices[service as ConnectorService] ?? service;
}

export function connectorStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'pending':
      return '等待第三方授权';
    case 'failed':
      return '授权失败';
    case 'expired':
      return '授权已过期';
    case 'cancelled':
      return '授权已取消';
    default:
      return '尚未连接';
  }
}

async function readError(response: Response): Promise<string> {
  if (response.status === 401) return '请先登录。';
  if (response.status === 403) return '当前会话校验已变化，请刷新后重试。';
  if (response.status === 503)
    return '网关配置未就绪或授权服务不可用，请联系管理员核对授权状态。';
  return '操作未确认，请先刷新状态，不要重复授权。';
}

/**
 * Reads and mutates the real Open Connector gateway state. No simulated authorization:
 * a missing gateway configuration surfaces as an unavailable state instead of a fake
 * success.
 */
export function useConnectors() {
  const [rows, setRows] = useState<ConnectorRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setStatus('loading');
    try {
      const response = await fetch('/api/v1/open-connector', { cache: 'no-store' });
      if (request !== generation.current) return;
      if (!response.ok) {
        setRows([]);
        setStatus('error');
        setMessage(await readError(response));
        return;
      }
      setRows(z.array(ConnectorRowSchema).parse(await response.json()));
      setStatus('ready');
      setMessage('授权由 Open Connector / OOMOL 网关处理，AVEN 不保存第三方账号密码。');
    } catch {
      if (request === generation.current) {
        setRows([]);
        setStatus('error');
        setMessage('读取失败，请重试。');
      }
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const connect = useCallback(
    async (service: string) => {
      if (busy) return null;
      setBusy(true);
      setMessage('');
      try {
        const response = await fetch(`/api/v1/open-connector/${service}/connect`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': webCall().auth.csrfToken ?? '' },
        });
        if (!response.ok) {
          setMessage(await readError(response));
          return null;
        }
        const result = ConnectResponseSchema.parse(await response.json());
        await load();
        return result.authorizationUrl;
      } catch {
        setMessage('结果未知，请先核对状态，不会自动重试。');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const refresh = useCallback(
    async (service: string) => {
      if (busy) return false;
      setBusy(true);
      setMessage('');
      try {
        const response = await fetch(`/api/v1/open-connector/${service}/refresh`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': webCall().auth.csrfToken ?? '' },
        });
        if (!response.ok) {
          setMessage(await readError(response));
          return false;
        }
        await load();
        return true;
      } catch {
        setMessage('结果未知，请先核对状态，不会自动重试。');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const disconnect = useCallback(
    async (service: string) => {
      if (busy) return false;
      setBusy(true);
      setMessage('');
      try {
        const response = await fetch(`/api/v1/open-connector/${service}`, {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': webCall().auth.csrfToken ?? '' },
        });
        if (!response.ok) {
          setMessage(await readError(response));
          return false;
        }
        await load();
        return true;
      } catch {
        setMessage('结果未知，请先核对状态，不会自动重试。');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const statusFor = useCallback(
    (service: string) => rows.find((row) => row.service === service)?.status,
    [rows],
  );

  return { rows, status, message, busy, load, connect, refresh, disconnect, statusFor };
}
