'use client';
import { useRef, useState } from 'react';
import type { ActionCreateResponse } from '@aven/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';
export function ActionPanel({ onExpired }: PrivateProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState<ActionCreateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unknown, setUnknown] = useState(false);
  const lock = useRef(false);
  const confirmKey = useRef(crypto.randomUUID());
  const cancelKey = useRef(crypto.randomUUID());
  async function act(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      if (authExpired(error)) onExpired();
      else {
        setMessage(errorText(error));
        setUnknown(true);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="行动草稿">
      <h3>行动草稿</h3>
      <p className="small muted">先预览，再确认创建记忆。用途默认关闭，不发送给其他人。</p>
      {message && <Alert variant="warning">{message}</Alert>}
      {draft ? (
        <>
          <p>
            状态：{draft.status} · 版本 {draft.draftVersion}
          </p>
          <p>截止 {new Date(draft.expiresAt).toLocaleString('zh-CN')}</p>
          <div className="memory-card">
            <strong>{String(draft.preview.title ?? '')}</strong>
            <p className="whitespace-pre-wrap">{String(draft.preview.content ?? '')}</p>
            <p className="small muted">用途：仅本人保存</p>
          </div>
          {draft.status === 'pending_confirmation' && (
            <div className="button-row">
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await api.actions.confirm(
                      draft.id,
                      {
                        expectedDraftVersion: draft.draftVersion,
                        confirmationToken: draft.confirmationToken,
                      },
                      confirmKey.current,
                      webCall(),
                    );
                    setDraft({ ...result, confirmationToken: draft.confirmationToken });
                    setUnknown(false);
                  })
                }
              >
                {unknown ? '沿用本次确认核对结果' : '确认创建记忆'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await api.actions.cancel(draft.id, cancelKey.current, webCall());
                    setDraft({ ...result, confirmationToken: draft.confirmationToken });
                    setUnknown(false);
                  })
                }
              >
                取消草稿
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await api.actions.get(draft.id, webCall());
                setDraft({ ...result, confirmationToken: draft.confirmationToken });
                setUnknown(false);
              })
            }
          >
            核对行动状态
          </Button>
          {['succeeded', 'cancelled', 'expired', 'failed'].includes(draft.status) && (
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(null);
                setContent('');
                setTitle('');
              }}
            >
              准备另一条草稿
            </Button>
          )}
        </>
      ) : (
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
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
                  webCall(),
                ),
              );
              confirmKey.current = crypto.randomUUID();
              cancelKey.current = crypto.randomUUID();
            });
          }}
        >
          <Label htmlFor="action-title">草稿标题</Label>
          <Input
            id="action-title"
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy || unknown}
          />
          <Label htmlFor="action-content">草稿正文</Label>
          <Textarea
            id="action-content"
            required
            maxLength={20000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy || unknown}
          />
          <Button type="submit" disabled={busy || unknown}>
            生成行动预览
          </Button>
          {unknown && (
            <p className="small muted">草稿创建结果未确认，不会自动重试；尚未执行创建记忆。</p>
          )}
        </form>
      )}
    </section>
  );
}
