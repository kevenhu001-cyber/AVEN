'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import '../admin/admin.css';
import { PluginLogo } from '../../features/personal/halo/plugin-logo';
import { webCall } from '../../features/personal/api';
const services = {
  gmail: 'Gmail',
  googledrive: 'Google Drive',
  github: 'GitHub',
  googlecalendar: 'Google Calendar',
  outlook: 'Outlook',
};
const RowsSchema = z.array(z.object({ service: z.string(), status: z.string() }));
export default function ConnectorsPage() {
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current += 1;
  }, []);
  const [rows, setRows] = useState<z.infer<typeof RowsSchema>>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在读取连接状态…');
  const [url, setUrl] = useState('');
  const load = useCallback(async () => {
    const request = ++generation.current;
    setReady(false);
    setRows([]);
    setUrl('');
    try {
      const result = await fetch('/api/v1/open-connector', { cache: 'no-store' });
      if (request !== generation.current) return;
      if (!result.ok) {
        setMessage(result.status === 401 ? '请先在首页登录。' : '连接状态暂时不可用。');
        return;
      }
      const rows = RowsSchema.parse(await result.json());
      if (request !== generation.current) return;
      setRows(rows);
      setReady(true);
      setMessage('授权由 Open Connector / OOMOL 网关处理，AVEN 不保存第三方账号密码。');
    } catch {
      if (request === generation.current) setMessage('读取失败，请重试。');
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    const hide = () => {
      invalidate();
      setReady(false);
      setRows([]);
      setUrl('');
    };
    const visible = () => {
      if (document.hidden) hide();
      else void load();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('offline', hide);
    return () => {
      active = false;
      invalidate();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('offline', hide);
    };
  }, [load, invalidate]);
  const action = useCallback(
    async (service: string, kind: 'connect' | 'refresh' | 'disconnect') => {
      if (busy) return;
      const request = generation.current;
      setBusy(true);
      setUrl('');
      try {
        const response = await fetch(
          `/api/v1/open-connector/${service}${kind === 'disconnect' ? '' : `/${kind}`}`,
          {
            method: kind === 'disconnect' ? 'DELETE' : 'POST',
            headers: { 'X-CSRF-Token': webCall().auth.csrfToken ?? '' },
          },
        );
        if (request !== generation.current) return;
        if (!response.ok) {
          setMessage(
            response.status === 503
              ? '网关配置未就绪或授权服务不可用，请联系管理员；不会回退为模拟授权。'
              : '操作未确认，请先刷新状态，不要重复授权。',
          );
          return;
        }
        if (kind === 'connect') {
          const result = z
            .object({ authorizationUrl: z.url().refine((v) => new URL(v).protocol === 'https:') })
            .parse(await response.json());
          if (request !== generation.current) return;
          setUrl(result.authorizationUrl);
          setMessage(
            '即将离开 AVEN。请在第三方授权页检查权限范围后决定是否授权，返回后点击“核对授权结果”。',
          );
        } else {
          await load();
        }
      } catch {
        setMessage('结果未知，请先核对状态，不会自动重试。');
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );
  return (
    <main className="platform-page" style={{ maxWidth: 760, margin: 'auto', padding: 24 }}>
      <Link href="/">返回 AVEN</Link>
      <h1>第三方账号连接</h1>
      <Link href="/plugins">浏览插件目录</Link>
      <p role="status">{message}</p>
      <button disabled={busy} onClick={() => void load()}>
        刷新列表
      </button>
      {url && (
        <p>
          <a href={url} target="_blank" rel="noopener noreferrer">
            确认前往授权页面
          </a>{' '}
          <button onClick={() => setUrl('')}>暂不前往</button>
        </p>
      )}
      {ready &&
        Object.entries(services).map(([id, name]) => (
          <section key={id} style={{ marginTop: 24 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <PluginLogo id={id} category="productivity" />
              {name}
            </h2>
            <p>{rows.find((r) => r.service === id)?.status ?? '尚未连接'}</p>
            <button disabled={busy} onClick={action.bind(null, id, 'connect')}>
              发起授权
            </button>{' '}
            <button disabled={busy} onClick={action.bind(null, id, 'refresh')}>
              核对授权结果
            </button>{' '}
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    '仅移除 AVEN 的本地关联，第三方平台授权仍需到提供方撤销。是否继续？',
                  )
                )
                  void action(id, 'disconnect');
              }}
            >
              移除本地关联
            </button>
          </section>
        ))}
      <p>真实账号授权和已有 Mock 结果卡片分别展示；当前尚未开放真实邮箱读取或写入。</p>
    </main>
  );
}
