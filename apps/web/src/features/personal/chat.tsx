'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PrivateProps } from './api';
import { Icon } from './icon';
import { Mascot } from './mascot';
import { Modal } from './modal';
import { ConnectorDialog, type ConnectorResult } from './plugins/connector-dialog';
import { WidgetCard } from './plugins/widget-card';
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
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [connectorResults, setConnectorResults] = useState<ConnectorResult[]>([]);

  useEffect(() => {
    if (nearBottom.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
    else setLatest(true);
  }, [chat.turns, connectorResults]);

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
        <Badge variant="outline" className="mode-label rounded-full font-normal">
          AI · Mock
        </Badge>
        <Button variant="ghost" onClick={chat.reset} disabled={chat.busy}>
          新对话
        </Button>
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
                <Alert variant="warning" className="my-2">
                  {turn.error}
                </Alert>
              )}
              {turn.status === 'unknown' && (
                <Button variant="secondary" onClick={() => void chat.retryCreate(turn)}>
                  核对发送结果
                </Button>
              )}
              {turn.status === 'disconnected' && turn.runId && (
                <Button variant="secondary" onClick={() => void chat.resume(turn)}>
                  重新读取回复
                </Button>
              )}
            </article>
          ))}
          {connectorResults.map((result) => (
            <article key={result.key} className="chat-turn widget-turn">
              <div className="widget-turn-head">
                <Mascot state="happy" />
                <span>
                  {result.pluginName} · {result.actionTitle}
                </span>
                <Badge variant={result.providerMode === 'live' ? 'success' : 'warning'}>
                  {result.providerMode === 'live' ? '实时数据' : 'Mock 数据'}
                </Badge>
              </div>
              <p className="chat-bubble assistant-bubble">{result.summary}</p>
              {result.widgets.map((widget) => (
                <WidgetCard key={widget.widgetId} widget={widget} />
              ))}
            </article>
          ))}
        </div>
      </div>
      {latest && (
        <Button
          variant="secondary"
          className="latest-button"
          onClick={() => {
            if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
            nearBottom.current = true;
            setLatest(false);
          }}
        >
          回到最新消息
        </Button>
      )}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          nearBottom.current = true;
          chat.send();
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="border-border bg-card text-foreground"
          aria-label="连接器"
          title="连接器"
          onClick={() => setConnectorsOpen(true)}
          disabled={chat.busy}
        >
          <Icon name="plug" />
        </Button>
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
          <Button
            type="button"
            size="icon"
            className="round-button"
            disabled={active.status === 'cancelling'}
            onClick={() => void chat.cancel(active)}
            aria-label="停止回复"
          >
            <Icon name="square" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="round-button"
            disabled={!chat.draft.trim() || chat.busy}
            aria-label="发送消息"
          >
            <Icon name="arrow-up" />
          </Button>
        )}
      </form>
      <p className="composer-note">Enter 发送 · Shift + Enter 换行 · 当前对话仅在本页显示</p>
      {connectorsOpen && (
        <Modal title="连接器" onClose={() => setConnectorsOpen(false)}>
          <ConnectorDialog
            onClose={() => setConnectorsOpen(false)}
            onExpired={onExpired}
            onResult={(result) => {
              setConnectorResults((current) => [...current, result]);
              nearBottom.current = true;
              setConnectorsOpen(false);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
