import { useState } from 'react';
import type { MemoryItem } from '@aven/contracts';
import { useSession } from './session';
import { useOperation, useRemote } from './remote';
import { Action, Card, Copy, Field, Loading, Page, Problem, Toggle, confirm } from './ui';
import { uncertain } from './api';
import { ActionScreen } from './action-screen';

export function MemoryScreen() {
  const { api, call } = useSession();
  const remote = useRemote((signal) =>
    Promise.all([api.memories.list(call(signal)), api.memories.candidates(call(signal))]),
  );
  const op = useOperation();
  const [actions, setActions] = useState(false);
  const [editor, setEditor] = useState<MemoryItem | 'new' | null>(null);
  const [text, setText] = useState('');
  const [unknown, setUnknown] = useState(false);
  if (actions)
    return (
      <ActionScreen
        onBack={() => {
          setActions(false);
          void remote.reload();
        }}
      />
    );
  if (editor)
    return (
      <MemoryEditor
        key={editor === 'new' ? 'new' : editor.id}
        item={editor === 'new' ? null : editor}
        onBack={() => {
          setEditor(null);
          void remote.reload();
        }}
      />
    );
  return (
    <Page>
      <Copy title>记忆与上下文</Copy>
      <Copy muted>每项用途独立选择。允许进入共享预览不等于已发送给其他人。</Copy>
      <Action onPress={() => setEditor('new')}>手工记录</Action>
      <Action secondary onPress={() => setActions(true)}>
        行动草稿
      </Action>
      <Action
        secondary
        onPress={() => {
          setUnknown(false);
          void remote.reload();
        }}
        disabled={op.busy || remote.busy}
      >
        刷新并核对
      </Action>
      <Problem message={remote.problem || op.problem} />
      {remote.busy && <Loading />}
      <Card>
        <Copy title>候选复核</Copy>
        <Copy muted>规则提取 mock_rules_v1，仅生成候选，不代表真实模型理解。</Copy>
        <Field
          label="待提取的文本"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={20000}
          editable={!op.busy && !unknown}
        />
        <Action
          disabled={op.busy || unknown || !text.trim()}
          onPress={() =>
            void op.run(async (signal) => {
              try {
                await api.memories.extract({ text, sourceType: 'conversation' }, call(signal));
                setText('');
                await remote.reload();
              } catch (error) {
                setUnknown(uncertain(error));
                throw error;
              }
            })
          }
        >
          提取候选（规则模式）
        </Action>
        {unknown && <Copy muted>结果未确认，请先刷新核对候选再继续。</Copy>}
        {remote.data?.[1].data.length === 0 && <Copy muted>没有待复核候选。</Copy>}
        {remote.data?.[1].data.map((item) => (
          <Card key={item.id}>
            <Copy>{item.title}</Copy>
            <Copy muted>{item.content}</Copy>
            <Action secondary onPress={() => setEditor(item)}>
              复核此条
            </Action>
          </Card>
        ))}
      </Card>
      <Copy title>已确认的信息</Copy>
      {remote.data?.[0].data.length === 0 && <Copy muted>还没有已确认的信息。</Copy>}
      {remote.data?.[0].data.map((item) => (
        <Card key={item.id}>
          <Copy>{item.title}</Copy>
          <Copy>{item.content}</Copy>
          <Copy muted>用途：{item.policy.allowedUses.join(' / ') || '仅本人保存'}</Copy>
          <Action secondary onPress={() => setEditor(item)}>
            编辑或撤回
          </Action>
        </Card>
      ))}
    </Page>
  );
}
function MemoryEditor({ item, onBack }: { item: MemoryItem | null; onBack: () => void }) {
  const { api, call } = useSession();
  const op = useOperation();
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const pending = item?.status === 'pending_confirmation';
  const [selfAi, setSelfAi] = useState(
    pending ? false : (item?.policy.allowedUses.includes('self_ai') ?? false),
  );
  const [sharing, setSharing] = useState(
    pending ? false : (item?.policy.allowedUses.includes('sharing') ?? false),
  );
  const [unclear, setUnclear] = useState(false);
  const uses = [
    ...(selfAi ? ['self_ai' as const] : []),
    ...(sharing ? ['sharing' as const] : []),
    ...(!pending && item?.policy.allowedUses.includes('matching') ? ['matching' as const] : []),
  ];
  function save() {
    void op.run(async (signal) => {
      try {
        if (!item)
          await api.memories.create(
            {
              kind: 'interest',
              title,
              content,
              allowedUses: uses,
              sensitivity: 'normal',
              displayAudience: 'owner',
              discoverable: false,
            },
            call(signal),
          );
        else if (pending)
          await api.memories.confirm(
            item.id,
            { title, content, allowedUses: uses, expectedVersion: item.version },
            call(signal),
          );
        else
          await api.memories.update(
            item.id,
            { title, content, allowedUses: uses, expectedVersion: item.version },
            call(signal),
          );
        onBack();
      } catch (error) {
        setUnclear(true);
        throw error;
      }
    });
  }
  return (
    <Page>
      <Action secondary onPress={onBack} disabled={op.busy}>
        返回并刷新
      </Action>
      <Copy title>{!item ? '记录一条信息' : pending ? '复核候选' : '编辑信息'}</Copy>
      <Problem message={op.problem} />
      <Field
        label="标题"
        value={title}
        onChangeText={setTitle}
        maxLength={160}
        editable={!op.busy && !unclear}
      />
      <Field
        label="正文"
        value={content}
        onChangeText={setContent}
        multiline
        maxLength={20000}
        editable={!op.busy && !unclear}
      />
      <Toggle
        label="允许用于本人 AI"
        value={selfAi}
        onChange={setSelfAi}
        disabled={op.busy || unclear}
      />
      <Toggle
        label="允许进入共享预览"
        value={sharing}
        onChange={setSharing}
        disabled={op.busy || unclear}
      />
      <Action onPress={save} disabled={op.busy || unclear || !title.trim() || !content.trim()}>
        {pending ? '确认此条信息' : '保存信息'}
      </Action>
      {item && pending && (
        <Action
          secondary
          disabled={op.busy || unclear}
          onPress={() =>
            void op.run(async (signal) => {
              try {
                await api.memories.reject(item.id, item.version, call(signal));
                onBack();
              } catch (error) {
                setUnclear(true);
                throw error;
              }
            })
          }
        >
          拒绝候选
        </Action>
      )}
      {item && !pending && (
        <Action
          secondary
          disabled={op.busy || unclear}
          onPress={() =>
            confirm(
              '撤回此条信息？',
              '新的授权读取将被阻断，已送达或系统外保存的副本无法收回。',
              () =>
                void op.run(async (signal) => {
                  try {
                    await api.memories.remove(item.id, item.version, call(signal));
                    onBack();
                  } catch (error) {
                    setUnclear(true);
                    throw error;
                  }
                }),
            )
          }
        >
          撤回此条信息
        </Action>
      )}
      {unclear && <Copy muted>版本或结果需要核对。请返回刷新后再操作。</Copy>}
    </Page>
  );
}
