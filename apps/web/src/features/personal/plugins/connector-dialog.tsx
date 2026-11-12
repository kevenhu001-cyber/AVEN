'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationWidget, PluginActionManifest, PluginManifest } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { api, authExpired, errorText, webCall } from '../api';
import {
  buildPluginInput,
  initialPluginValues,
  missingRequiredFields,
  type PluginInputSchema,
} from './plugin-input';

export type ConnectorResult = {
  key: string;
  pluginId: string;
  pluginName: string;
  actionTitle: string;
  summary: string;
  providerMode: string;
  widgets: ConversationWidget[];
};

const categoryLabels: Record<string, string> = {
  maps: '地图',
  commerce: '购物',
  lifestyle: '生活',
  mail: '邮箱',
  social: '社交',
  calendar: '日程',
};

const fieldLabels: Record<string, string> = {
  query: '关键词',
  city: '城市',
  limit: '数量',
  address: '地址',
  minPriceYuan: '最低价（元）',
  maxPriceYuan: '最高价（元）',
  selfOperatedOnly: '只看自营',
  sortBy: '排序方式',
  deliveryAddress: '配送地址',
  maxEtaMinutes: '最长送达时间（分钟）',
  maxAvgPriceYuan: '人均上限（元）',
  unreadOnly: '只看未读',
  to: '收件人（逗号分隔）',
  cc: '抄送（逗号分隔）',
  subject: '主题',
  body: '正文',
  draftId: '草稿编号',
  confirmed: '已确认发送',
  targetUserId: '目标用户 ID',
  displayName: '显示名',
  headline: '一句话介绍',
  matchReason: '匹配理由',
  status: '连接状态',
  selectedFields: '共享字段（逗号分隔）',
  expiresInDays: '有效天数',
  prompt: '你的需求',
  defaultTimezone: '默认时区',
  referenceNow: '参考时间',
  dateLabel: '日期',
  limitPerPlatform: '每个平台数量',
};

function credentialBadge(plugin: PluginManifest) {
  if (plugin.credentialStatus === 'mock_only') return <Badge variant="outline">仅 Mock</Badge>;
  if (plugin.credentialStatus === 'configured') return <Badge variant="success">已配置</Badge>;
  return <Badge variant="warning">缺少凭据</Badge>;
}

export function ConnectorDialog({
  onClose,
  onResult,
  onExpired,
}: {
  onClose: () => void;
  onResult: (result: ConnectorResult) => void;
  onExpired: () => void;
}) {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<PluginManifest | null>(null);
  const [action, setAction] = useState<PluginActionManifest | null>(null);
  const loader = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    loader.current?.abort();
    const controller = new AbortController();
    loader.current = controller;
    return api.plugins
      .listCatalog(webCall(controller.signal))
      .then((result) => {
        if (!controller.signal.aborted) setPlugins(result.plugins);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (authExpired(cause)) onExpired();
        else setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [onExpired]);

  useEffect(() => {
    void load();
    return () => loader.current?.abort();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, PluginManifest[]>();
    for (const plugin of plugins) {
      const list = map.get(plugin.category) ?? [];
      list.push(plugin);
      map.set(plugin.category, list);
    }
    return [...map.entries()];
  }, [plugins]);

  return (
    <section className="flex flex-col gap-3">
      <p className="muted m-0">
        连接器按需调用。当前只运行服务端 Mock
        适配器，不会连接真实邮箱、地图或电商账号，也不会修改任何外部数据。
      </p>
      {error && <Alert variant="warning">{error}</Alert>}
      {loading ? (
        <p role="status">正在读取连接器目录…</p>
      ) : (
        <>
          {grouped.map(([category, items]) => (
            <div key={category} className="flex flex-col gap-2">
              <h3 className="m-0">{categoryLabels[category] ?? category}</h3>
              {items.map((plugin) => (
                <div key={plugin.id} className="connector-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{plugin.name}</strong>
                    {credentialBadge(plugin)}
                    {plugin.readOnly ? (
                      <Badge variant="outline">只读</Badge>
                    ) : (
                      <Badge variant="warning">可写入</Badge>
                    )}
                  </div>
                  <p className="small muted m-0">{plugin.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {plugin.actions.map((item) => (
                      <Button
                        key={item.name}
                        variant="secondary"
                        onClick={() => {
                          setSelected(plugin);
                          setAction(item);
                        }}
                      >
                        {item.title}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={load} disabled={loading}>
          刷新目录
        </Button>
        <Button variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </div>
      {selected && action && (
        <ActionForm
          plugin={selected}
          action={action}
          onClose={() => {
            setSelected(null);
            setAction(null);
          }}
          onResult={(result) => {
            onResult(result);
            setSelected(null);
            setAction(null);
          }}
          onExpired={onExpired}
        />
      )}
    </section>
  );
}

function ActionForm({
  plugin,
  action,
  onClose,
  onResult,
  onExpired,
}: {
  plugin: PluginManifest;
  action: PluginActionManifest;
  onClose: () => void;
  onResult: (result: ConnectorResult) => void;
  onExpired: () => void;
}) {
  const schema = action.inputJsonSchema as PluginInputSchema;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => initialPluginValues(schema));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const missing = missingRequiredFields(schema, values);

  async function invoke() {
    if (busy || missing.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.plugins.invoke(
        plugin.id,
        { action: action.name, input: buildPluginInput(schema, values), allowLive: false },
        webCall(),
      );
      onResult({
        key: result.invocationId,
        pluginId: plugin.id,
        pluginName: plugin.name,
        actionTitle: action.title,
        summary: result.summary,
        providerMode: result.providerMode,
        widgets: result.widgets,
      });
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-form">
      <Separator />
      <h3 className="m-0">
        {plugin.name} · {action.title}
      </h3>
      <p className="small muted m-0">{action.description}</p>
      {Object.entries(properties).map(([key, property]) => {
        const id = `connector-${plugin.id}-${action.name}-${key}`;
        const label = property.description ?? fieldLabels[key] ?? key;
        if (property.type === 'boolean') {
          return (
            <label key={key} className="check-row" htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                checked={values[key] === 'true'}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: String(event.target.checked) }))
                }
                disabled={busy}
              />
              {label}
            </label>
          );
        }
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={id}>{property.description ?? fieldLabels[key] ?? key}</Label>
              {required.includes(key) && <Badge variant="outline">必填</Badge>}
            </div>
            {property.enum ? (
              <select
                id={id}
                className="border-border bg-card text-foreground rounded-[14px] border px-3 py-2"
                value={values[key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                disabled={busy}
              >
                <option value="">请选择</option>
                {property.enum.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : property.type === 'array' ? (
              <Textarea
                id={id}
                rows={2}
                value={values[key] ?? ''}
                placeholder="多个值用逗号分隔"
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                disabled={busy}
              />
            ) : (
              <Input
                id={id}
                type={property.type === 'number' || property.type === 'integer' ? 'number' : 'text'}
                value={values[key] ?? ''}
                maxLength={property.maxLength}
                min={property.minimum}
                max={property.maximum}
                aria-required={required.includes(key)}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                disabled={busy}
              />
            )}
          </div>
        );
      })}
      {missing.length > 0 && <Alert variant="warning">请先填写必填项：{missing.join('、')}</Alert>}
      {error && <Alert variant="warning">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void invoke()} disabled={busy || missing.length > 0}>
          {busy ? '正在调用…' : '调用（Mock 模式）'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          取消
        </Button>
      </div>
      <p className="small muted m-0">
        调用会以 Mock 模式执行；真实外部账号未接入，任何外部跳转都需要你再次确认。
      </p>
    </div>
  );
}
