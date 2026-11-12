'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockItem, ReportItem, ReportReason } from '@aven/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { api, webCall, authExpired, errorText, type PrivateProps } from './api';
const reasons: Record<ReportReason, string> = {
  spam: '垃圾信息',
  harassment: '骚扰',
  inappropriate_content: '不当内容',
  privacy_violation: '隐私侵害',
  other: '其他',
};
export function SafetyPanel({ onExpired }: PrivateProps) {
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const options = useCallback((signal?: AbortSignal) => {
    const csrfToken = webCall().auth.csrfToken;
    return { ...(csrfToken ? { csrfToken } : {}), ...(signal ? { signal } : {}) };
  }, []);
  const load = useCallback(
    (signal?: AbortSignal) =>
      Promise.all([
        api.moderation.listBlocks(options(signal)),
        api.moderation.listReports(options(signal)),
      ])
        .then(([a, b]) => {
          if (!signal?.aborted) {
            setBlocks(a.blocks);
            setReports(b.reports);
          }
        })
        .catch((error) => {
          if (!signal?.aborted) {
            if (authExpired(error)) onExpired();
            else setMessage(errorText(error));
          }
        }),
    [onExpired, options],
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);
  async function act(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
      setTarget('');
      setDetails('');
      await load();
    } catch (error) {
      if (authExpired(error)) onExpired();
      else setMessage(errorText(error) + ' 请先刷新核对结果。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="安全与举报">
      <h3>安全与举报</h3>
      <p className="small muted">
        拉黑后阻断双方的新邀请与消息。举报仅提交记录，处理状态以服务端为准。
      </p>
      {message && <Alert variant="warning">{message}</Alert>}
      <Label htmlFor="safety-target">对方连接码</Label>
      <Input
        id="safety-target"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        maxLength={50}
        disabled={busy}
      />
      <Label htmlFor="safety-details">补充说明（可选）</Label>
      <Input
        id="safety-details"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={1000}
        disabled={busy}
      />
      <Label htmlFor="safety-reason">举报原因</Label>
      <select
        id="safety-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value as ReportReason)}
        disabled={busy}
      >
        {Object.entries(reasons).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <div className="button-row">
        <Button
          disabled={busy || !target.trim()}
          onClick={() => {
            if (window.confirm('拉黑此用户？双方的新邀请与消息将被阻断。'))
              void act(async () => {
                await api.moderation.blockUser(
                  { blockedUserId: target.trim().replace(/^aven:/i, '') },
                  options(),
                );
              });
          }}
        >
          拉黑用户
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !target.trim()}
          onClick={() => {
            if (window.confirm('提交举报？请确认目标与原因。'))
              void act(async () => {
                await api.moderation.submitReport(
                  {
                    targetType: 'user',
                    targetId: target.trim().replace(/^aven:/i, ''),
                    reason,
                    details,
                  },
                  options(),
                );
              });
          }}
        >
          提交举报
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          刷新安全记录
        </Button>
      </div>
      <h4>已拉黑用户</h4>
      {!blocks.length && <p className="small muted">没有拉黑记录。</p>}
      {blocks.map((item) => (
        <div className="memory-card" key={item.id}>
          <p className="wrap">aven:{item.blockedUserId}</p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm('解除拉黑？将允许双方再次发送邀请或消息。'))
                void act(async () => {
                  await api.moderation.unblockUser(item.blockedUserId, options());
                });
            }}
          >
            解除拉黑
          </Button>
        </div>
      ))}
      <h4>我的举报</h4>
      {!reports.length && <p className="small muted">没有举报记录。</p>}
      {reports.map((item) => (
        <div className="memory-card" key={item.id}>
          <p>
            {reasons[item.reason]} · {item.status}
          </p>
          <p className="small wrap">{item.targetId}</p>
        </div>
      ))}
    </section>
  );
}
