'use client';
import { Icon } from './icon';
import { useEffect, useRef, useState } from 'react';
import type { PrivateProps } from './api';
import { Mascot } from './mascot';
import { useAgentChat } from './use-agent-chat';
const labels = {
  sending: '正在确认发送…',
  unknown: '正在等待核对发送结果',
  queued: '已排队，等待回复',
  running: '正在生成回复',
  cancelling: '正在请求停止',
  completed: '回复完成',
  cancelled: '已停止',
  failed: '本次回复未完成',
  disconnected: '回复读取已断开',
};
export function Chat({ suspended, onExpired }: PrivateProps & { suspended: boolean }) {
  const chat = useAgentChat(suspended, onExpired);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const [latest, setLatest] = useState(false);
  useEffect(() => {
    if (nearBottom.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
    else setLatest(true);
  }, [chat.turns]);
  useEffect(() => {
    const node = input.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, 156)}px`;
    }
  }, [chat.draft]);
  const active = [...chat.turns]
    .reverse()
    .find((turn) => ['queued', 'running', 'cancelling'].includes(turn.status));
  // Keep the hook mounted while private content is hidden during session checks.
  if (suspended) return null;
  return (
    <section className="chat-space" aria-label="与 AVEN 对话">
      <div className="chat-toolbar">
        <span className="mode-label">AI · Mock</span>
        <button className="text-button" onClick={chat.reset} disabled={chat.busy}>
          新对话
        </button>
      </div>
      <div
        className="chat-transcript"
        ref={transcript}
        tabIndex={0}
        aria-label="对话内容"
        onScroll={() => {
          const n = transcript.current;
          if (n) {
            nearBottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 70;
            if (nearBottom.current) setLatest(false);
          }
        }}
      >
        {!chat.turns.length && (
          <div className="chat-welcome">
            <Mascot large />
            <h1>今天，想聊点什么？</h1>
            <p className="muted">从一个还没成形的想法开始也可以。</p>
            <p className="small muted">当前是确定性 Mock 回复，不代表真实模型能力。</p>
          </div>
        )}
        <div className="chat-thread">
          {chat.turns.map((turn) => (
            <article key={turn.key} className="chat-turn">
              <p className="chat-bubble user-bubble">{turn.input}</p>
              {turn.answer && <p className="chat-bubble assistant-bubble">{turn.answer}</p>}
              <div className="turn-state">
                <Mascot
                  state={
                    turn.status === 'completed'
                      ? 'happy'
                      : ['failed', 'disconnected', 'cancelled'].includes(turn.status)
                        ? 'sleepy'
                        : 'thinking'
                  }
                />
                <span>{labels[turn.status]}</span>
              </div>
              {turn.error && (
                <p className="notice" role="status">
                  {turn.error}
                </p>
              )}
              {turn.status === 'unknown' && (
                <button className="secondary" onClick={() => void chat.retryCreate(turn)}>
                  核对发送结果
                </button>
              )}
              {turn.status === 'disconnected' && turn.runId && (
                <button className="secondary" onClick={() => void chat.resume(turn)}>
                  重新读取回复
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
      {latest && (
        <button
          className="latest-button secondary"
          onClick={() => {
            if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
            nearBottom.current = true;
            setLatest(false);
          }}
        >
          回到最新消息
        </button>
      )}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          nearBottom.current = true;
          chat.send();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          向 AVEN 提问
        </label>
        <textarea
          id="chat-input"
          ref={input}
          value={chat.draft}
          onChange={(event) => chat.setDraft(event.target.value)}
          placeholder="向 AVEN 提问"
          maxLength={8000}
          rows={1}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              nearBottom.current = true;
              chat.send();
            }
          }}
        />
        {active ? (
          <button
            type="button"
            className="round-button"
            disabled={active.status === 'cancelling'}
            onClick={() => void chat.cancel(active)}
            aria-label="停止回复"
          >
            <Icon name="square" />
          </button>
        ) : (
          <button
            type="submit"
            className="round-button"
            disabled={!chat.draft.trim() || chat.busy}
            aria-label="发送消息"
          >
            <Icon name="arrow-up" />
          </button>
        )}
      </form>
      <p className="composer-note">Enter 发送 · Shift + Enter 换行 · 当前对话仅在本页显示</p>
    </section>
  );
}
