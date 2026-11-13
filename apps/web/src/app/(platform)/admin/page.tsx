'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { AdminConfigInputSchema, AdminConfigMetadataSchema } from '@aven/contracts';
import { PageHead, Panel } from '@/components/shell/page';
import { webCall } from '@/features/personal/api';

type Metadata = z.infer<typeof AdminConfigMetadataSchema>;
const ListSchema = z.object({
  data: z.array(AdminConfigMetadataSchema),
  connectorEnvironmentConfigured: z.boolean().optional(),
});

export default function AdminPage() {
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current += 1;
  }, []);
  const [rows, setRows] = useState<Metadata[]>([]);
  const [environmentConfigured, setEnvironmentConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('正在验证管理员权限…');
  const load = useCallback(async (signal?: AbortSignal) => {
    if (document.hidden) return;
    const request = ++generation.current;
    setReady(false);
    try {
      const response = await fetch('/api/v1/admin/configurations', {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      });
      if (request !== generation.current) return;
      if (!response.ok) {
        setRows([]);
        setMessage(
          response.status === 401
            ? '请先在首页登录，再返回管理页面。'
            : response.status === 403
              ? '当前账号没有平台管理员权限。'
              : '配置暂时无法读取，请重试。',
        );
        return;
      }
      const parsed = ListSchema.parse(await response.json());
      if (signal?.aborted || request !== generation.current) return;
      setRows(parsed.data);
      setEnvironmentConfigured(parsed.connectorEnvironmentConfigured ?? false);
      setReady(true);
      setMessage('管理员权限已确认。配置密钥不会回显；保存后新的对话与授权会使用该配置。');
    } catch {
      if (!signal?.aborted && request === generation.current) {
        setRows([]);
        setMessage('无法读取配置，请检查连接后重试。');
      }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    const hide = () => {
      invalidate();
      setReady(false);
      setRows([]);
    };
    const visible = () => {
      if (document.hidden) hide();
      else void load();
    };
    const refresh = () => {
      void load();
    };
    window.addEventListener('offline', hide);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      invalidate();
      controller.abort();
      window.removeEventListener('offline', hide);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load, invalidate]);
  return (
    <div className="page">
      <PageHead
        title="平台配置"
        description="管理员手动配置模型与 Open Connector 网关。密钥加密保存且不会回显。"
        actions={
          <button type="button" className="shell-link-button" onClick={() => void load()}>
            刷新配置与权限
          </button>
        }
      />
      <p role="status" className="muted">
        {message}
      </p>
      {ready && environmentConfigured && (
        <p className="muted">
          已配置服务器 Open Connector 网关密钥；此处保存的网关配置优先生效，密钥不会回显。
        </p>
      )}
      {ready && (
        <>
          <ConfigForm
            kind="model"
            title="模型 · OpenAI-compatible"
            current={rows.find((r) => r.kind === 'model')}
            onSaved={() => load()}
          />
          <ConfigForm
            kind="open_connector"
            title="Open Connector · OOMOL"
            current={rows.find((r) => r.kind === 'open_connector')}
            onSaved={() => load()}
          />
        </>
      )}
    </div>
  );
}

function ConfigForm({
  kind,
  title,
  current,
  onSaved,
}: {
  kind: 'model' | 'open_connector';
  title: string;
  current?: Metadata | undefined;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <Panel>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>
            {current ? `已保存 · 版本 ${current.version}` : '尚未配置'} ·{' '}
            {kind === 'model' ? '新的对话会使用该模型' : '仅用于显式账号授权'}
          </p>
        </div>
      </div>
      <form
        key={current?.version ?? 0}
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const form = event.currentTarget;
          const values = new FormData(form);
          const parsed = AdminConfigInputSchema.safeParse({
            baseUrl: values.get('baseUrl'),
            model: values.get('model') ?? '',
            apiKey: values.get('apiKey'),
            expectedVersion: current?.version ?? 0,
          });
          if (!parsed.success || (kind === 'model' && !parsed.data.model)) {
            setMessage('请填写有效的 HTTPS 地址、模型名称和密钥。');
            return;
          }
          setBusy(true);
          setMessage('正在保存…');
          try {
            const { apiKey, ...metadata } = parsed.data;
            const body = JSON.stringify({ ...metadata, apiKey });
            form.reset();
            const response = await fetch(`/api/v1/admin/configurations/${kind}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': webCall().auth.csrfToken ?? '',
              },
              body,
            });
            if (!response.ok) {
              setMessage(
                response.status === 409
                  ? '版本已变化，请刷新后重新填写。'
                  : response.status === 403
                    ? '管理员权限或会话校验失败，请刷新。'
                    : '保存未确认，请刷新核对后再操作。',
              );
              return;
            }
            await onSaved();
          } catch {
            setMessage('保存结果未知，请刷新核对；不会自动重试。');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="stack-label">
          API 地址
          <input
            name="baseUrl"
            type="url"
            defaultValue={current?.baseUrl ?? ''}
            required
            disabled={busy}
          />
        </label>
        {kind === 'model' && (
          <label className="stack-label">
            模型名称
            <input
              name="model"
              defaultValue={current?.model ?? ''}
              required
              maxLength={120}
              disabled={busy}
            />
          </label>
        )}
        <label className="stack-label">
          {kind === 'model' ? 'API Key' : 'Project API Key'}
          <input
            name="apiKey"
            type="password"
            autoComplete="new-password"
            required
            maxLength={4096}
            disabled={busy}
          />
        </label>
        <p className="small muted m-0">
          地址须由服务端允许列表批准。每次保存需重新输入密钥，不在浏览器持久化。
        </p>
        <div className="account-actions">
          <button type="submit" className="shell-link-button" data-tone="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存配置'}
          </button>
        </div>
        <p role="status" className="small muted m-0">
          {message}
        </p>
      </form>
    </Panel>
  );
}
