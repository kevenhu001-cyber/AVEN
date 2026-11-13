'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MeResponse, UserAIProviderMetadata } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/shell/page';
import { api, authExpired, errorText, webCall } from './api';
import { useProviderStatus } from './use-provider-status';

export function AccountPanel({
  me,
  onRetry,
  onLogout,
  onExpired,
}: {
  me: MeResponse;
  onRetry: () => void;
  onLogout: () => void;
  onExpired: () => void;
}) {
  return (
    <div className="account-stack">
      <Panel title="账号">
        <div className="halo-account-head">
          <span className="halo-avatar halo-avatar-lg" aria-hidden="true">
            {Array.from(me.user.displayName)[0]}
          </span>
          <div className="min-w-0">
            <h3 className="m-0">{me.user.displayName}</h3>
            <p className="wrap m-0 text-sm text-muted-foreground">{me.user.email}</p>
          </div>
          <Badge variant={me.user.emailVerified ? 'success' : 'warning'}>
            {me.user.emailVerified ? '邮箱已验证' : '邮箱尚未验证'}
          </Badge>
        </div>
        {!me.user.emailVerified && <VerifyEmail onVerified={onRetry} />}
        <div className="account-actions">
          <Button variant="secondary" onClick={onLogout}>
            退出登录
          </Button>
        </div>
      </Panel>
      <ProviderSettings onExpired={onExpired} />
      <Panel title="更多" description="工程与账号相关页面。">
        <nav className="account-links" aria-label="更多页面">
          <Link href="/connectors">第三方账号授权</Link>
          <Link href="/plugins">插件目录</Link>
          <Link href="/admin">平台管理</Link>
          <Link href="/diagnostics">工程诊断</Link>
        </nav>
      </Panel>
    </div>
  );
}

function VerifyEmail({ onVerified }: { onVerified: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.auth.verifyEmail(token);
      setToken('');
      onVerified();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-form" onSubmit={(event) => void verify(event)}>
      <p className="small muted m-0">连接邀请等操作需要验证邮箱。请使用验证邮件中的验证码。</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verify-email-token">邮箱验证码</Label>
        <Input
          id="verify-email-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          minLength={20}
          maxLength={256}
          required
          autoComplete="off"
          disabled={busy}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? '正在验证…' : '验证邮箱'}
      </Button>
      {error && <Alert variant="warning">{error}</Alert>}
    </form>
  );
}

function ProviderSettings({ onExpired }: { onExpired: () => void }) {
  const status = useProviderStatus();
  const [current, setCurrent] = useState<UserAIProviderMetadata | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);

  const load = useCallback(() => {
    api.agent
      .getProvider(webCall())
      .then((result) => {
        setCurrent(result);
        if (result) {
          setBaseUrl(result.baseUrl);
          setModel(result.model);
        }
      })
      .catch((cause) => {
        if (authExpired(cause)) setError('登录已失效，请重新登录。');
        else setError(errorText(cause));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.agent.saveProvider(
        {
          baseUrl,
          model,
          apiKey,
          expectedVersion: current?.version ?? 0,
        },
        webCall(),
      );
      setCurrent(result);
      setApiKey('');
      setNotice(`模型配置已保存 · 版本 ${result.version}`);
      await status.reload();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (!current || lock.current) return;
    if (!window.confirm('删除本人模型配置？之后会回退到平台配置（若已配置）。')) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.agent.deleteProvider(current.version, webCall());
      setCurrent(null);
      setBaseUrl('');
      setModel('');
      setApiKey('');
      setNotice('已删除本人模型配置。');
      await status.reload();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const effective = status.status;
  return (
    <Panel title="模型" description="使用你自己的 OpenAI-compatible 服务。密钥加密保存且不会回显。">
      <div className="provider-status" data-configured={effective?.configured ?? false}>
        <span className="shell-provider-dot" aria-hidden="true" />
        <span>
          {effective
            ? effective.configured
              ? `当前生效：${effective.model}（${
                  effective.source === 'user'
                    ? '本人配置'
                    : effective.source === 'platform'
                      ? '平台配置'
                      : '环境配置'
                }）`
              : '当前没有可用的真实模型，对话会返回未配置错误。'
            : '正在读取模型状态…'}
        </span>
      </div>
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-base-url">API 地址</Label>
          <Input
            id="provider-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://openrouter.ai/api/v1"
            required
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-model">模型名称</Label>
          <Input
            id="provider-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="deepseek/deepseek-v4.1-flash-1017"
            required
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-api-key">API Key</Label>
          <Input
            id="provider-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={current ? '留空则保持现有密钥不变' : 'sk-…'}
            required={!current}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        <div className="account-actions">
          <Button type="submit" disabled={busy || (!current && !apiKey)}>
            {busy ? '正在保存…' : current ? '更新模型配置' : '保存模型配置'}
          </Button>
          {current && (
            <Button type="button" variant="secondary" onClick={() => void remove()} disabled={busy}>
              删除本人配置
            </Button>
          )}
        </div>
        {notice && <p className="small muted m-0">{notice}</p>}
        {error && <Alert variant="warning">{error}</Alert>}
      </form>
      <p className="small muted m-0">
        地址必须属于服务器允许列表。保存后新的对话会使用该模型；已有对话不会自动重跑。
      </p>
    </Panel>
  );
}
