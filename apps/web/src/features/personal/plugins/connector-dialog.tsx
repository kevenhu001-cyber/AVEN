'use client';

import { useEffect, useRef, useState } from 'react';
import type { PluginActionManifest, PluginManifest } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, authExpired, errorText, webCall } from '../api';
import type { ConnectorResult } from '../halo/types';
import {
  buildPluginInput,
  initialPluginValues,
  invalidPluginFields,
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
 * Runs one plugin action against the server. Live execution is requested only
 * when the connector reports real credentials; otherwise the form is disabled
 * instead of returning simulated data.
 */
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
  const canRun = plugin.credentialStatus === 'configured';

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const missing = missingRequiredFields(schema, values);
  const invalid = invalidPluginFields(schema, values);
  const fieldName = (key: string) => fieldLabels[key] ?? properties[key]?.description ?? key;

  async function invoke() {
    if (busy || !canRun || missing.length || invalid.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.plugins.invoke(
        plugin.id,
        { action: action.name, input: buildPluginInput(schema, values), allowLive: true },
        webCall(),
      );
      if (!mounted.current) return;
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
      if (!mounted.current) return;
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="stack-form halo-action-form">
      <h3 className="m-0">
        {plugin.name} · {action.title}
      </h3>
      <p className="small muted m-0">{action.description}</p>
      {!canRun && (
        <Alert variant="warning">
          该服务尚未配置真实凭据，暂不能调用。请先在账号授权页完成授权，或由管理员配置服务凭据。
        </Alert>
      )}
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
                disabled={busy || !canRun}
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
                disabled={busy || !canRun}
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
                disabled={busy || !canRun}
              />
            ) : (
              <Input
                id={id}
                type={property.type === 'number' || property.type === 'integer' ? 'number' : 'text'}
                value={values[key] ?? ''}
                maxLength={property.maxLength}
                step={property.type === 'integer' ? 1 : 'any'}
                aria-invalid={invalid.includes(key)}
                min={property.minimum}
                max={property.maximum}
                aria-required={required.includes(key)}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                disabled={busy || !canRun}
              />
            )}
          </div>
        );
      })}
      {missing.length > 0 && (
        <Alert variant="warning">请先填写必填项：{missing.map(fieldName).join('、')}</Alert>
      )}
      {invalid.length > 0 && (
        <Alert variant="warning">请检查参数的格式或范围：{invalid.map(fieldName).join('、')}</Alert>
      )}
      {error && <Alert variant="warning">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void invoke()}
          disabled={busy || !canRun || missing.length > 0 || invalid.length > 0}
        >
          {busy ? '正在调用…' : '调用'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          取消
        </Button>
      </div>
      <p className="small muted m-0">
        调用使用服务端已配置的真实凭据；需要外部跳转时会再次征求你的确认。
      </p>
    </div>
  );
}
