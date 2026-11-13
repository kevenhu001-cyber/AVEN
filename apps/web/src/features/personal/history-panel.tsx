'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageContent, CopyMessage } from './message-content';
import { Icon } from './icon';
import type { AgentHistoryItem } from '@aven/contracts';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { api, authExpired, errorText, webCall, type PrivateProps } from './api';

export function HistoryPanel({ onExpired }: PrivateProps) {
  const [items, setItems] = useState<AgentHistoryItem[]>([]);
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  async function load(more = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setAnswer('');
    setSelected(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await api.agent.history(
        more && cursor ? { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id } : {},
        webCall(abort.signal),
      );
      if (!abort.signal.aborted) {
        setItems((old) => (more ? [...old, ...result.data] : result.data));
        setCursor(result.nextCursor);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (authExpired(error)) onExpired();
        else setMessage(errorText(error));
      }
    } finally {
      lock.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  const initialLoad = useCallback(
    (signal: AbortSignal) =>
      api.agent
        .history({}, webCall(signal))
        .then((result) => {
          if (!signal.aborted) {
            setItems(result.data);
            setCursor(result.nextCursor);
          }
        })
        .catch((error) => {
          if (!signal.aborted) {
            if (authExpired(error)) onExpired();
            else setMessage(errorText(error));
          }
        })
        .finally(() => {
          if (!signal.aborted) setBusy(false);
        }),
    [onExpired],
  );
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    void initialLoad(abort.signal);
    return () => controller.current?.abort();
  }, [initialLoad]);
  async function replay(item: AgentHistoryItem) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setAnswer('');
    setSelected(item.id);
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      for await (const event of api.agent.events(item.id, 0, webCall(abort.signal))) {
        if (abort.signal.aborted) return;
        if (event.type === 'message.delta') setAnswer((text) => text + event.text);
        if (event.type === 'turn.failed') {
          setAnswer('');
          setMessage('回复未完成或来源已失效，无法显示。');
        }
        if (event.type === 'turn.cancelled') setMessage('此轮对话已停止。');
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        setAnswer('');
        if (authExpired(error)) onExpired();
        else setMessage(errorText(error) + ' 回复仅保留 24 小时，无法恢复时不会重新生成。');
      }
    } finally {
      lock.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="对话记录">
      <p className="small muted">
        显示本人个人对话的运行记录，不保存本地正文。点击后重新验证授权并读取 24
        小时内的回复；不包含用户输入或连接器结果。
      </p>
      <Button variant="secondary" disabled={busy} onClick={() => void load()}>
        刷新记录
      </Button>
      {message && <Alert variant="warning">{message}</Alert>}
      {busy && <p role="status">正在读取…</p>}
      {!busy && !items.length && (
        <div className="workspace-empty">
          <Icon name="history" />
          <h3>对话从这里开始</h3>
          <p>开始聊天后，保留期内的回复会显示在这里。</p>
        </div>
      )}
      {items.map((item) => (
        <div className="memory-card flex flex-col gap-2" key={item.id}>
          <strong>{new Date(item.createdAt).toLocaleString('zh-CN')}</strong>
          <span>
            {item.provider === 'mock'
              ? '模拟对话'
              : item.provider === 'user_openai_compatible'
                ? '个人渠道'
                : '默认模型'}{' '}
            ·{' '}
            {
              {
                queued: '等待回复',
                running: '生成中',
                cancelling: '正在停止',
                completed: '已完成',
                cancelled: '已停止',
                failed: '未完成',
              }[item.status]
            }
          </span>
          <Button variant="secondary" disabled={busy} onClick={() => void replay(item)}>
            重新读取此轮回复
          </Button>
          {selected === item.id && answer && (
            <div className="history-answer">
              <MessageContent text={answer} />
              {!busy && <CopyMessage text={answer} />}
            </div>
          )}
        </div>
      ))}
      {cursor && (
        <Button variant="secondary" disabled={busy} onClick={() => void load(true)}>
          更早的记录
        </Button>
      )}
    </section>
  );
}
