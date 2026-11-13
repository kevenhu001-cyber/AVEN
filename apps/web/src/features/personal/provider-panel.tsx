'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiClientError, createApiClient } from '@aven/api-client';
import { UserAIProviderInputSchema, type UserAIProviderMetadata } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { authExpired, errorText, webCall, type PrivateProps } from './api';
import { agentFailureText } from './agent-error';
import { Icon } from './icon';
const client = createApiClient({ timeoutMs: 25000 }).agent;
export function ProviderPanel({ onExpired, onChanged }: PrivateProps & { onChanged: () => void }) {
  const [saved, setSaved] = useState<UserAIProviderMetadata | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [available, setAvailable] = useState(false);
  const lock = useRef(false);
  const loader = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const load = useCallback(() => {
    loader.current?.abort();
    const controller = new AbortController();
    loader.current = controller;
    return client
      .provider(webCall(controller.signal))
      .then((value) => {
        if (!controller.signal.aborted) {
          setMessage('');
          setSuccess(false);
          setConfirmDelete(false);
          setSaved(value);
          setBaseUrl(value?.baseUrl ?? '');
          setModel(value?.model ?? '');
          setApiKey('');
          setAvailable(true);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setAvailable(false);
          if (authExpired(error)) onExpired();
          else setMessage('无法读取渠道配置，请重新读取后再操作。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [onExpired]);
  useEffect(() => {
    void load();
    return () => loader.current?.abort();
  }, [load]);
  function input() {
    return UserAIProviderInputSchema.parse({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      expectedVersion: saved?.version ?? 0,
      expectedConfigId: saved?.configId ?? null,
    });
  }
  async function act(kind: 'save' | 'test' | 'delete') {
    if (lock.current || !available) return;
    if (kind !== 'delete' && form.current && !form.current.reportValidity()) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setSuccess(false);
    try {
      if (kind === 'save') {
        const value = await client.saveProvider(input(), webCall());
        setSaved(value);
        setApiKey('');
        setSuccess(true);
        setMessage('已保存。接下来的个人对话将使用这个渠道；排队中的旧配置请求需要重新发起。');
        onChanged();
      } else if (kind === 'test') {
        const result = await client.testProvider(input(), webCall());
        setSuccess(result.ok);
        setMessage(
          result.ok
            ? '连接测试成功，渠道已返回有效回复。测试不会保存配置，请点击“保存并使用”使其生效。'
            : agentFailureText(result.errorCode),
        );
      } else if (saved) {
        await client.deleteProvider(saved.version, saved.configId, webCall());
        setSaved(null);
        setBaseUrl('');
        setModel('');
        setApiKey('');
        setConfirmDelete(false);
        setSuccess(true);
        setMessage('已删除个人渠道，接下来的对话将使用站点默认渠道。');
        onChanged();
      }
    } catch (error) {
      if (authExpired(error)) onExpired();
      else if (error instanceof ApiClientError && error.status === 409) {
        await load();
        setMessage('配置已在其他位置变更，已重新读取。请核对后再操作。');
      } else
        setMessage(
          error instanceof ApiClientError
            ? errorText(error) + (kind === 'save' ? ' 保存结果未知时，请重新读取配置核对。' : '')
            : '请检查接口地址、模型名称和 API Key。',
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void act('save');
  }
  return (
    <section className="provider-settings" aria-label="模型与渠道配置">
      <div className="provider-intro">
        <span className="provider-icon">
          <Icon name="settings" />
        </span>
        <div>
          <h2>连接你自己的 AI</h2>
          <p>支持 OpenAI-compatible 接口，仅用于你的个人对话。</p>
        </div>
      </div>
      <div className="provider-status">
        <span>
          {loading
            ? '正在读取配置…'
            : !available
              ? '配置暂不可用'
              : saved
                ? '正在使用个人渠道'
                : '正在使用站点默认渠道'}
        </span>
        <Button
          variant="ghost"
          disabled={busy || loading}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          重新读取
        </Button>
      </div>
      {message && <Alert variant={success ? 'success' : 'warning'}>{message}</Alert>}
      {loading ? (
        <p role="status" className="muted">
          正在读取…
        </p>
      ) : (
        <form ref={form} className="stack-form provider-form" onSubmit={save}>
          <div className="provider-field">
            <Label htmlFor="provider-url">接口地址（Base URL）</Label>
            <Input
              id="provider-url"
              type="url"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              required
              maxLength={2048}
              disabled={busy || !available}
              autoComplete="off"
            />
            <p>填写 API 根地址，系统自动追加 /chat/completions。仅支持公网 HTTPS，端口 443。</p>
          </div>
          <div className="provider-field">
            <Label htmlFor="provider-model">模型名称</Label>
            <Input
              id="provider-model"
              placeholder="填写渠道提供的模型 ID"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              required
              maxLength={120}
              disabled={busy || !available}
              autoComplete="off"
            />
            <p>使用渠道提供的准确模型名称，不会自动替换模型。</p>
          </div>
          <div className="provider-field">
            <Label htmlFor="provider-key">API Key</Label>
            <Input
              id="provider-key"
              type="password"
              placeholder={saved ? '已安全保存，留空保留原 Key' : '输入渠道的 API Key'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required={!saved}
              maxLength={500}
              disabled={busy || !available}
              autoComplete="off"
              spellCheck={false}
            />
            <p>密钥加密保存在服务端，不回显，也不写入浏览器持久存储。</p>
          </div>
          <div className="provider-actions">
            <Button type="submit" disabled={busy || !available}>
              {busy ? '正在处理…' : '保存并使用'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !available}
              onClick={() => void act('test')}
            >
              测试连接
            </Button>
          </div>
          <p className="provider-disclosure">
            保存后仅向该渠道发送当前提问及本次获准上下文。测试只发送一条固定探针，不读取记忆。连接器与外部行动权限不会改变。
          </p>
        </form>
      )}
      {saved && (
        <>
          <Separator />
          <div className="provider-remove">
            <div>
              <h3>恢复站点默认渠道</h3>
              <p>删除个人配置和密钥，不会删除已有对话。</p>
            </div>
            {!confirmDelete ? (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
                删除个人渠道
              </Button>
            ) : (
              <div className="button-row">
                <Button variant="destructive" disabled={busy} onClick={() => void act('delete')}>
                  确认删除并恢复默认
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
