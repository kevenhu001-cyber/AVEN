'use client';

import { useState } from 'react';
import type { PluginActionManifest, PluginManifest } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, authExpired, errorText, webCall } from '../api';
import { Icon } from '../icon';
import { connectButton, credentialLabel, groupCatalog } from '../halo/catalog';
import { PluginLogo } from '../halo/plugin-logo';
import type { CatalogState, ConnectorResult } from '../halo/types';
import {
  buildPluginInput,
  initialPluginValues,
  missingRequiredFields,
  type PluginInputSchema,
} from './plugin-input';

export type { ConnectorResult } from '../halo/types';

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

/**
 * 连接应用 sheet body (Halo). Catalog from GET /api/v1/plugins, grouped 精选插件 + categories,
 * searchable. Row buttons start a Mock authorization card in the chat; tapping a row expands
 * its actions, which invoke the server Mock adapter exactly as before (allowLive: false).
 */
export function ConnectAppsList({
  catalog,
  connected,
  query,
  onConnect,
  onResult,
  onExpired,
}: {
  catalog: CatalogState;
  connected: ReadonlySet<string>;
  query: string;
  onConnect: (plugin: PluginManifest) => void;
  onResult: (result: ConnectorResult) => void;
  onExpired: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [action, setAction] = useState<{
    plugin: PluginManifest;
    action: PluginActionManifest;
  } | null>(null);
  const sections = groupCatalog(catalog.plugins, query);

  return (
    <section className="halo-apps" aria-busy={catalog.loading}>
      <p className="halo-apps-note">
        连接器按需调用。当前只运行服务端 Mock
        适配器，不会连接真实邮箱、地图或电商账号，也不会修改任何外部数据。
      </p>
      {catalog.error && (
        <Alert variant="warning">
          {catalog.error}{' '}
          <button type="button" className="halo-text-button" onClick={() => void catalog.load()}>
            刷新目录
          </button>
        </Alert>
      )}
      {catalog.loading && !catalog.plugins.length && (
        <div className="halo-apps-loading" role="status">
          <span className="halo-skeleton" />
          <span className="halo-skeleton" />
          <span className="halo-skeleton" />
          <span className="sr-only">正在读取连接器目录…</span>
        </div>
      )}
      {catalog.loaded && !sections.length && (
        <p className="halo-empty">没有找到匹配的应用或技能。</p>
      )}
      {sections.map((section) => (
        <div key={section.id} className="halo-apps-section">
          <h3 className="halo-apps-heading">
            {section.title}
            {section.browsable && <Icon name="chevron" size={20} />}
          </h3>
          <ul className="halo-apps-list">
            {section.plugins.map((plugin) => {
              const button = connectButton(plugin, connected);
              const expanded = open === `${section.id}:${plugin.id}`;
              return (
                <li key={plugin.id} className="halo-app-item" data-expanded={expanded}>
                  <div className="halo-app-row">
                    <button
                      type="button"
                      className="halo-app-main halo-press-soft"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : `${section.id}:${plugin.id}`)}
                    >
                      <PluginLogo id={plugin.id} category={plugin.category} />
                      <span className="halo-app-text">
                        <span className="halo-app-name">{plugin.name}</span>
                        <span className="halo-app-desc">{plugin.description}</span>
                        <span className="halo-app-meta">
                          <span>{credentialLabel(plugin.credentialStatus)}</span>
                          <span>{plugin.readOnly ? '只读' : '可写入'}</span>
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`halo-pill halo-pill-${button.tone} halo-press`}
                      disabled={button.disabled}
                      aria-label={`${button.label} ${plugin.name}`}
                      onClick={() => onConnect(plugin)}
                    >
                      {button.label}
                    </button>
                  </div>
                  {expanded && (
                    <div className="halo-app-actions">
                      {plugin.actions.map((item) => (
                        <Button
                          key={item.name}
                          variant="secondary"
                          size="sm"
                          onClick={() => setAction({ plugin, action: item })}
                        >
                          {item.title}
                        </Button>
                      ))}
                    </div>
                  )}
                  {expanded && action && action.plugin.id === plugin.id && (
                    <ActionForm
                      plugin={action.plugin}
                      action={action.action}
                      onClose={() => setAction(null)}
                      onResult={(result) => {
                        setAction(null);
                        onResult(result);
                      }}
                      onExpired={onExpired}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function ActionForm({
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
    <div className="stack-form halo-action-form">
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
