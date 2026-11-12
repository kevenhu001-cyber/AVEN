'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { PeerMessage, PeerMessageCursor } from '@aven/contracts';
import { api, authExpired, errorText, writeUncertain, webCall, type PrivateProps } from './api';
export function PeerChat({
  connectionId,
  userId,
  onExpired,
  onBack,
}: PrivateProps & { connectionId: string; userId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<PeerMessage[]>([]);
  const [cursor, setCursor] = useState<PeerMessageCursor | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ content: string; clientMessageId: string } | null>(null);
  const [pendingUnknown, setPendingUnknown] = useState(false);
  const lock = useRef(false);
  const loader = useRef<AbortController | null>(null);
  const load = useCallback(
    (older?: PeerMessageCursor) => {
      loader.current?.abort();
      const controller = new AbortController();
      loader.current = controller;
      return api.connections
        .listMessages(
          connectionId,
          older ? { cursorCreatedAt: older.createdAt, cursorId: older.id } : {},
          webCall(controller.signal),
        )
        .then((result) => {
          if (controller.signal.aborted) return;
          setMessages((current) => {
            const map = new Map((older ? current : []).map((message) => [message.id, message]));
            result.messages.forEach((message) => map.set(message.id, message));
            return [...map.values()].sort(
              (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
            );
          });
          setCursor(result.nextCursor);
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setMessages([]);
          if (authExpired(cause)) onExpired();
          else setError(errorText(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [connectionId, onExpired],
  );
  useEffect(() => {
    void load();
    return () => loader.current?.abort();
  }, [load]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (lock.current) return;
    const content = draft.trim();
    if (!pending.current && !content) return;
    pending.current ??= { content, clientMessageId: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setPendingUnknown(true);
    setError('');
    try {
      await api.connections.sendMessage(connectionId, pending.current, webCall());
      pending.current = null;
      setPendingUnknown(false);
      setDraft('');
      await load();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else {
        if (!writeUncertain(cause)) {
          pending.current = null;
          setPendingUnknown(false);
        }
        setError(errorText(cause) + (writeUncertain(cause) ? ' 重试会沿用同一次消息标识。' : ''));
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove(message: PeerMessage) {
    if (lock.current || !window.confirm('从你的会话中删除这条消息？这不会替对方删除。')) return;
    lock.current = true;
    setBusy(true);
    try {
      await api.connections.deleteMessage(connectionId, message.id, webCall());
      await load();
    } catch (cause) {
      if (authExpired(cause)) onExpired();
      else {
        setMessages([]);
        setError(errorText(cause));
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="连接会话">
      <div className="section-heading">
        <button className="text-button" onClick={onBack}>
          返回连接
        </button>
        <button
          className="text-button"
          onClick={() => {
            setMessages([]);
            setCursor(null);
            setLoading(true);
            setError('');
            void load();
          }}
          disabled={loading || busy}
        >
          刷新消息
        </button>
      </div>
      <p className="small muted">与你的连接聊天 · 当前使用手动刷新，没有即时推送。</p>
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      {cursor && (
        <button className="secondary" disabled={loading} onClick={() => void load(cursor)}>
          更早消息
        </button>
      )}
      {loading && <p role="status">正在读取消息…</p>}
      <div className="peer-messages">
        {!loading && !messages.length && <p className="muted">还没有消息，从一句你好开始吧。</p>}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`peer-message ${message.senderUserId === userId ? 'own' : ''}`}
          >
            <p className="small muted">{message.senderUserId === userId ? '你' : '对方'}</p>
            <p>{message.content}</p>
            <button
              className="text-button small"
              onClick={() => void remove(message)}
              disabled={busy}
            >
              删除此消息
            </button>
          </article>
        ))}
      </div>
      <form className="stack-form" onSubmit={(event) => void send(event)}>
        <label>
          给对方留言
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
            required
            disabled={busy || pendingUnknown}
            rows={2}
          />
        </label>
        <button type="submit" disabled={busy || (!draft.trim() && !pendingUnknown)}>
          {busy ? '正在发送…' : pendingUnknown ? '核对并重试同一消息' : '发送给对方'}
        </button>
      </form>
    </section>
  );
}
