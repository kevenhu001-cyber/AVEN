'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MemoryItem } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';

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
    <div className="flex flex-col gap-3">
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
            <Card key={item.id}>
              <CardHeader>
                <CardTitle>{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="m-0">{item.content}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant={item.policy.allowedUses.includes('self_ai') ? 'accent' : 'outline'}
                  >
                    本人 AI：{item.policy.allowedUses.includes('self_ai') ? '允许' : '不允许'}
                  </Badge>
                  <Badge
                    variant={item.policy.allowedUses.includes('sharing') ? 'accent' : 'outline'}
                  >
                    准备共享：{item.policy.allowedUses.includes('sharing') ? '允许' : '不允许'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="small muted m-0">
        当前显示最近 100 条已确认信息；编辑、候选复核和完整生命周期界面将在后续接入。
      </p>
    </div>
  );
}
