'use client';

import { ActionPanel } from './action-panel';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ContextUse, MemoryItem } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';
import { CandidateReview } from './candidate-review';

export function MemoriesPanel({ onExpired }: PrivateProps) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selfAi, setSelfAi] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const loader = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    loader.current?.abort();
    const controller = new AbortController();
    loader.current = controller;
    return api.memories
      .list(webCall(controller.signal))
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.data);
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

  function reload() {
    setLoading(true);
    setError('');
    setItems([]);
    void load();
  }

  useEffect(() => {
    void load();
    return () => loader.current?.abort();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.memories.create(
        {
          kind: 'interest',
          title,
          content,
          sensitivity: 'normal',
          displayAudience: 'owner',
          discoverable: false,
          allowedUses: [
            ...(selfAi ? ['self_ai' as const] : []),
            ...(sharing ? ['sharing' as const] : []),
          ],
        },
        webCall(),
      );
      setTitle('');
      setContent('');
      setSelfAi(false);
      setSharing(false);
      await load();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(`${errorText(cause)} 如保存结果未知，请先刷新列表检查。`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Tabs defaultValue="confirmed">
      <TabsList>
        <TabsTrigger value="confirmed">已确认信息</TabsTrigger>
        <TabsTrigger value="candidates">候选复核</TabsTrigger>
        <TabsTrigger value="actions">行动草稿</TabsTrigger>
      </TabsList>
      <TabsContent value="confirmed" className="flex flex-col gap-3">
        <p className="muted m-0">
          你确认的信息，才可以按所选用途使用。允许准备共享，不等于已经分享。
        </p>
        <form className="stack-form" onSubmit={(event) => void create(event)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="memory-title">一条想让 AVEN 了解的信息</Label>
            <Input
              id="memory-title"
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：我对机器人项目感兴趣"
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="memory-content">具体内容</Label>
            <Textarea
              id="memory-content"
              required
              maxLength={20000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={busy}
              rows={3}
            />
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={selfAi}
              onChange={(e) => setSelfAi(e.target.checked)}
              disabled={busy}
            />
            允许用于本人 AI
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={sharing}
              onChange={(e) => setSharing(e.target.checked)}
              disabled={busy}
            />
            允许进入共享预览（发送前仍需确认）
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? '正在保存…' : '确认并保存'}
          </Button>
        </form>
        <div className="section-heading">
          <h3>已确认的信息</h3>
          <Button variant="ghost" onClick={reload} disabled={loading || busy}>
            刷新列表
          </Button>
        </div>
        {error && <Alert variant="warning">{error}</Alert>}
        {loading ? (
          <p role="status">正在读取…</p>
        ) : !items.length ? (
          <p className="muted">还没有确认的信息。你可以先保存一小段介绍。</p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <MemoryCard key={item.id} item={item} onExpired={onExpired} onChanged={reload} />
            ))}
          </div>
        )}
        <p className="small muted m-0">
          当前显示最近 100 条已确认信息。撤回会立即删除该条信息，已送达的共享副本无法收回。
        </p>
      </TabsContent>
      <TabsContent value="candidates">
        <CandidateReview onExpired={onExpired} onConfirmed={reload} />
      </TabsContent>
      <TabsContent value="actions">
        <ActionPanel onExpired={onExpired} />
      </TabsContent>
    </Tabs>
  );
}

const useLabels: Array<{ value: ContextUse; label: string }> = [
  { value: 'self_ai', label: '本人 AI' },
  { value: 'sharing', label: '准备共享' },
];

function MemoryCard({
  item,
  onExpired,
  onChanged,
}: {
  item: MemoryItem;
  onExpired: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [uses, setUses] = useState<ContextUse[]>(item.policy.allowedUses);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.memories.update(
        item.id,
        {
          expectedVersion: item.version,
          title: title.trim(),
          content: content.trim(),
          allowedUses: uses,
        },
        webCall(),
      );
      setEditing(false);
      onChanged();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.memories.remove(item.id, item.version, webCall());
      setConfirming(false);
      onChanged();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {editing ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`memory-title-${item.id}`}>标题</Label>
              <Input
                id={`memory-title-${item.id}`}
                value={title}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`memory-content-${item.id}`}>内容</Label>
              <Textarea
                id={`memory-content-${item.id}`}
                value={content}
                maxLength={20000}
                rows={3}
                onChange={(event) => setContent(event.target.value)}
                disabled={busy}
              />
            </div>
            {useLabels.map((use) => (
              <label key={use.value} className="check-row">
                <input
                  type="checkbox"
                  checked={uses.includes(use.value)}
                  onChange={(event) =>
                    setUses((current) =>
                      event.target.checked
                        ? [...current, use.value]
                        : current.filter((value) => value !== use.value),
                    )
                  }
                  disabled={busy}
                />
                {use.label}
              </label>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void save()}
                disabled={busy || !title.trim() || !content.trim()}
              >
                {busy ? '处理中…' : '保存修改'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setTitle(item.title);
                  setContent(item.content);
                  setUses(item.policy.allowedUses);
                  setError('');
                }}
                disabled={busy}
              >
                取消编辑
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="m-0">{item.content}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant={item.policy.allowedUses.includes('self_ai') ? 'accent' : 'outline'}>
                本人 AI：{item.policy.allowedUses.includes('self_ai') ? '允许' : '不允许'}
              </Badge>
              <Badge variant={item.policy.allowedUses.includes('sharing') ? 'accent' : 'outline'}>
                准备共享：{item.policy.allowedUses.includes('sharing') ? '允许' : '不允许'}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(true);
                  setError('');
                }}
              >
                编辑
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
                撤回这条信息
              </Button>
              {confirming && (
                <div className="flex flex-wrap items-center gap-2">
                  <Alert variant="warning">撤回后立即删除这条信息，无法恢复。</Alert>
                  <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
                    {busy ? '处理中…' : '确认撤回'}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                    取消
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
        {error && <Alert variant="warning">{error}</Alert>}
      </CardContent>
    </Card>
  );
}
