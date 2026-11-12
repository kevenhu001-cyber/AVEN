import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { ActionCreateResponse } from '@aven/contracts';
import { useSession } from './session';
import { useOperation } from './remote';
import { Action, Card, Copy, Field, Page, Problem } from './ui';
export function ActionScreen({ onBack }: { onBack: () => void }) {
  const { api, call } = useSession();
  const op = useOperation();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState<ActionCreateResponse | null>(null);
  const [creatingUnknown, setCreatingUnknown] = useState(false);
  const confirmKey = useRef(Crypto.randomUUID());
  const cancelKey = useRef(Crypto.randomUUID());
  return (
    <Page>
      <Action secondary disabled={op.busy} onPress={onBack}>
        返回记忆
      </Action>
      <Copy title>行动草稿</Copy>
      <Copy muted>先预览，再确认创建记忆。用途默认关闭，不共享给其他人。</Copy>
      <Problem message={op.problem} />
      {draft ? (
        <>
          <Copy>
            状态：{draft.status} · 版本 {draft.draftVersion}
          </Copy>
          <Copy muted>截止 {new Date(draft.expiresAt).toLocaleString('zh-CN')}</Copy>
          <Card>
            <Copy>{String(draft.preview.title ?? '')}</Copy>
            <Copy>{String(draft.preview.content ?? '')}</Copy>
            <Copy muted>用途：仅本人保存</Copy>
          </Card>
          {draft.status === 'pending_confirmation' && (
            <>
              <Action
                disabled={op.busy}
                onPress={() =>
                  void op.run(async (signal) => {
                    const result = await api.actions.confirm(
                      draft.id,
                      {
                        expectedDraftVersion: draft.draftVersion,
                        confirmationToken: draft.confirmationToken,
                      },
                      confirmKey.current,
                      call(signal),
                    );
                    setDraft({ ...result, confirmationToken: draft.confirmationToken });
                  })
                }
              >
                确认创建记忆（未知结果沿用本次确认）
              </Action>
              <Action
                secondary
                disabled={op.busy}
                onPress={() =>
                  void op.run(async (signal) => {
                    const result = await api.actions.cancel(
                      draft.id,
                      cancelKey.current,
                      call(signal),
                    );
                    setDraft({ ...result, confirmationToken: draft.confirmationToken });
                  })
                }
              >
                取消草稿
              </Action>
            </>
          )}
          <Action
            secondary
            disabled={op.busy}
            onPress={() =>
              void op.run(async (signal) => {
                const result = await api.actions.get(draft.id, call(signal));
                setDraft({ ...result, confirmationToken: draft.confirmationToken });
              })
            }
          >
            核对行动状态
          </Action>
        </>
      ) : (
        <>
          <Field
            label="草稿标题"
            value={title}
            onChangeText={setTitle}
            maxLength={160}
            editable={!op.busy && !creatingUnknown}
          />
          <Field
            label="草稿正文"
            value={content}
            onChangeText={setContent}
            maxLength={20000}
            multiline
            editable={!op.busy && !creatingUnknown}
          />
          <Action
            disabled={op.busy || creatingUnknown || !title.trim() || !content.trim()}
            onPress={() =>
              void op.run(async (signal) => {
                try {
                  setDraft(
                    await api.actions.create(
                      {
                        actionType: 'memory.create',
                        payload: {
                          kind: 'interest',
                          title,
                          content,
                          sensitivity: 'normal',
                          displayAudience: 'owner',
                          discoverable: false,
                          allowedUses: [],
                        },
                        expiresInSeconds: 600,
                      },
                      call(signal),
                    ),
                  );
                } catch (error) {
                  setCreatingUnknown(true);
                  throw error;
                }
              })
            }
          >
            生成行动预览
          </Action>
          {creatingUnknown && (
            <Copy muted>草稿创建结果未确认，不会自动重试；尚未执行创建记忆。</Copy>
          )}
        </>
      )}
    </Page>
  );
}
