import { useState } from 'react';
import type { PluginActionManifest, PluginManifest, PluginInvokeResponse } from '@aven/contracts';
import {
  initialPluginValues,
  missingRequiredFields,
  buildPluginInput,
  type PluginInputSchema,
} from '@aven/api-client';
import { useSession } from './session';
import { useOperation, useRemote } from './remote';
import { Action, Card, Copy, Field, Loading, Page, Problem, Toggle } from './ui';

export function ConnectorScreen({
  onBack,
  onResult,
}: {
  onBack: () => void;
  onResult: (result: PluginInvokeResponse) => void;
}) {
  const { api, call } = useSession();
  const remote = useRemote((signal) => api.plugins.listCatalog(call(signal)));
  const [selection, setSelection] = useState<{
    plugin: PluginManifest;
    action: PluginActionManifest;
  } | null>(null);
  if (selection)
    return (
      <ConnectorForm
        key={selection.plugin.id + selection.action.name}
        {...selection}
        onBack={() => setSelection(null)}
        onResult={onResult}
      />
    );
  return (
    <Page>
      <Action secondary onPress={onBack}>
        返回对话
      </Action>
      <Copy title>连接器</Copy>
      <Copy muted>当前仅调用 Mock 样例，不连接真实第三方账号。</Copy>
      <Problem message={remote.problem} />
      {remote.busy && <Loading />}
      <Action secondary disabled={remote.busy} onPress={() => void remote.reload()}>
        刷新目录
      </Action>
      {remote.data?.plugins.map((plugin) => (
        <Card key={plugin.id}>
          <Copy title>{plugin.name}</Copy>
          <Copy>{plugin.description}</Copy>
          <Copy muted>
            {plugin.category} · {plugin.credentialStatus} ·{' '}
            {plugin.readOnly ? '只读' : '含写入动作'}
          </Copy>
          {plugin.actions.map((action) => (
            <Action key={action.name} secondary onPress={() => setSelection({ plugin, action })}>
              {action.title}
            </Action>
          ))}
        </Card>
      ))}
    </Page>
  );
}
function ConnectorForm({
  plugin,
  action,
  onBack,
  onResult,
}: {
  plugin: PluginManifest;
  action: PluginActionManifest;
  onBack: () => void;
  onResult: (result: PluginInvokeResponse) => void;
}) {
  const { api, call } = useSession();
  const op = useOperation();
  const schema = action.inputJsonSchema as PluginInputSchema;
  const [values, setValues] = useState(() => initialPluginValues(schema));
  const missing = missingRequiredFields(schema, values);
  return (
    <Page>
      <Action secondary disabled={op.busy} onPress={onBack}>
        返回连接器
      </Action>
      <Copy title>{action.title}</Copy>
      <Copy muted>{action.description}</Copy>
      <Problem message={op.problem} />
      {Object.entries(schema.properties ?? {}).map(([key, property]) =>
        property.type === 'boolean' ? (
          <Toggle
            key={key}
            label={property.description ?? key}
            value={values[key] === 'true'}
            onChange={(value) => setValues((old) => ({ ...old, [key]: String(value) }))}
            disabled={op.busy}
          />
        ) : (
          <Field
            key={key}
            label={`${property.description ?? key}${schema.required?.includes(key) ? '（必填）' : ''}${property.enum ? `：${property.enum.join(' / ')}` : ''}`}
            value={values[key] ?? ''}
            onChangeText={(value) => setValues((old) => ({ ...old, [key]: value }))}
            keyboardType={
              property.type === 'number' || property.type === 'integer' ? 'numeric' : 'default'
            }
            maxLength={property.maxLength ?? 8000}
            multiline={property.type === 'array'}
            editable={!op.busy}
          />
        ),
      )}
      <Action
        disabled={op.busy || missing.length > 0}
        onPress={() =>
          void op.run(async (signal) => {
            const result = await api.plugins.invoke(
              plugin.id,
              { action: action.name, input: buildPluginInput(schema, values), allowLive: false },
              call(signal),
            );
            onResult(result);
          })
        }
      >
        调用（Mock 模式）
      </Action>
    </Page>
  );
}
