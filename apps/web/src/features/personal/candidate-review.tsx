'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextUse, MemoryCandidate } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';

const kindLabels: Record<string, string> = {
  interest: '兴趣',
  skill: '技能',
  project: '项目',
  goal: '目标',
  preference: '偏好',
  experience: '经历',
  education: '教育',
  other: '其他',
};

const useLabels: Array<{ value: ContextUse; label: string; hint: string }> = [
  { value: 'self_ai', label: '允许用于本人 AI', hint: '仅在本人对话与整理时使用' },
  { value: 'sharing', label: '允许进入共享预览', hint: '发送前仍需逐次确认' },
];

export function CandidateReview({
  onExpired,
  onConfirmed,
}: PrivateProps & { onConfirmed?: () => void }) {
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractor, setExtractor] = useState('');
  const loader = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    loader.current?.abort();
    const controller = new AbortController();
    loader.current = controller;
    return api.memories
      .candidates(webCall(controller.signal))
      .then((result) => {
        if (!controller.signal.aborted) setCandidates(result.data);
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

  async function extract() {
    if (extracting) return;
    setExtracting(true);
    setError('');
    setNotice('');
    try {
      const result = await api.memories.extract({ text, sourceType: 'conversation' }, webCall());
      setExtractor(result.extractor);
      setNotice(
        result.data.length
          ? `提取到 ${result.data.length} 条候选，请逐条确认或拒绝。`
          : '没有识别到候选。请使用「兴趣：」「技能：」等前缀按行描述。',
      );
      setText('');
      setLoading(true);
      await load();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      setExtracting(false);
    }
  }

  function drop(id: string) {
    setCandidates((current) => current.filter((item) => item.id !== id));
    onConfirmed?.();
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="muted m-0">
        候选只是建议，不是已确认的信息。只有你确认后，它才会按所选用途参与本人 AI 或共享预览。
      </p>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void extract();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="candidate-text">描述几件想被记住的事</Label>
          <Textarea
            id="candidate-text"
            required
            maxLength={20000}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="每行一条，例如：兴趣：机器人&#10;技能：产品设计"
            disabled={extracting}
          />
        </div>
        <Button type="submit" disabled={extracting || text.trim().length === 0}>
          {extracting ? '正在提取…' : '提取候选信息'}
        </Button>
        <p className="small muted m-0">
          当前使用服务端确定性规则提取（
          <code>{extractor || 'mock_rules_v1'}</code>
          ），不是真实模型理解；真实 Provider 尚未接入。
        </p>
      </form>
      {notice && <Alert variant="info">{notice}</Alert>}
      {error && <Alert variant="warning">{error}</Alert>}
      <div className="section-heading">
        <h3>待复核候选</h3>
        <Button
          variant="ghost"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={loading}
        >
          刷新候选
        </Button>
      </div>
      {loading ? (
        <p role="status">正在读取候选…</p>
      ) : !candidates.length ? (
        <p className="muted">暂无待复核候选。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              onExpired={onExpired}
              onDone={drop}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CandidateCard({
  candidate,
  onExpired,
  onDone,
}: {
  candidate: MemoryCandidate;
  onExpired: () => void;
  onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState(candidate.title);
  const [content, setContent] = useState(candidate.content);
  const [uses, setUses] = useState<ContextUse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.memories.confirm(
        candidate.id,
        {
          expectedVersion: candidate.version,
          title: title.trim(),
          content: content.trim(),
          allowedUses: uses,
        },
        webCall(),
      );
      onDone(candidate.id);
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.memories.reject(candidate.id, candidate.version, webCall());
      onDone(candidate.id);
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle>{candidate.title}</CardTitle>
        <Badge variant="outline">{kindLabels[candidate.kind] ?? candidate.kind}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {candidate.source?.excerpt && (
          <p className="small muted m-0">来源片段：{candidate.source.excerpt}</p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`candidate-title-${candidate.id}`}>标题</Label>
          <Input
            id={`candidate-title-${candidate.id}`}
            value={title}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`candidate-content-${candidate.id}`}>内容</Label>
          <Textarea
            id={`candidate-content-${candidate.id}`}
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
            <span>
              {use.label}
              <small className="muted">（{use.hint}）</small>
            </span>
          </label>
        ))}
        {error && <Alert variant="warning">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void confirm()}
            disabled={busy || !title.trim() || !content.trim()}
          >
            {busy ? '处理中…' : '确认并保存'}
          </Button>
          <Button variant="secondary" onClick={() => void reject()} disabled={busy}>
            拒绝
          </Button>
        </div>
        <p className="small muted m-0">
          用途默认全部拒绝；不勾选任何用途时确认，只保存为你本人可见的信息。
        </p>
      </CardContent>
    </Card>
  );
}
