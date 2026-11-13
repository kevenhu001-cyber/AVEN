'use client';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AgentRuntime } from '@aven/contracts';
import type { PrivateProps } from './api';
import { Icon } from './icon';
import { Mascot } from './mascot';
import { MessageContent, CopyMessage } from './message-content';
import { dayDividers, groupLabel } from './message-time';
import { Modal } from './modal';
import { ConnectorDialog, type ConnectorResult } from './plugins/connector-dialog';
import { WidgetCard } from './plugins/widget-card';
import { useAgentChat, type ChatTurn } from './use-agent-chat';

const labels = {
  sending: '正在发送…',
  unknown: '发送结果待确认',
  queued: '正在等待回复…',
  running: '正在回复…',
  cancelling: '正在停止…',
  completed: '',
  cancelled: '已停止',
  failed: '回复未完成',
  disconnected: '连接已中断',
};
export type ChatHandle = { reset: () => void; openConnectors: () => void };
export function Chat({
  suspended,
  runtime,
  visible = true,
  onExpired,
  onBusyChange,
  ref,
}: PrivateProps & {
  suspended: boolean;
  runtime: AgentRuntime | null;
  visible?: boolean;
  onBusyChange?: (busy: boolean) => void;
  ref?: Ref<ChatHandle>;
}) {
  const chat = useAgentChat(suspended, onExpired, runtime !== null);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const [latest, setLatest] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [connectorResults, setConnectorResults] = useState<
    (ConnectorResult & { createdAt: number })[]
  >([]);
  const [wasSuspended, setWasSuspended] = useState(suspended);
  if (wasSuspended !== suspended) {
    setWasSuspended(suspended);
    if (suspended) {
      setConnectorResults([]);
      setConnectorsOpen(false);
    }
  }
  useImperativeHandle(ref, () => ({
    reset() {
      if (chat.busy) return;
      chat.reset();
      setConnectorResults([]);
      nearBottom.current = true;
      setLatest(false);
      input.current?.focus();
    },
    openConnectors() {
      setConnectorsOpen(true);
    },
  }));
  useEffect(() => {
    onBusyChange?.(chat.busy);
  }, [chat.busy, onBusyChange]);
  useEffect(() => {
    if (!visible || suspended) return;
    if (nearBottom.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
    else setLatest(true);
  }, [chat.turns, connectorResults, visible, suspended]);
  useEffect(() => {
    const node = input.current;
    if (node && visible) {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, 156)}px`;
    }
  }, [chat.draft, visible]);
  const active = [...chat.turns]
    .reverse()
    .find((turn) => ['queued', 'running', 'cancelling'].includes(turn.status));
  if (suspended) return null;
  const items = [
    ...chat.turns.map((turn) => ({
      kind: 'turn' as const,
      createdAt: turn.createdAt,
      value: turn,
    })),
    ...connectorResults.map((result) => ({
      kind: 'connector' as const,
      createdAt: result.createdAt,
      value: result,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt);
  const dividers = dayDividers(items.map((item) => item.createdAt));
  return (
    <section className="chat-space" aria-label="与 AVEN 对话">
      <div
        className={`chat-transcript${items.length ? '' : ' is-empty'}`}
        ref={transcript}
        tabIndex={0}
        aria-label="对话内容"
        onScroll={() => {
          const node = transcript.current;
          if (node) {
            nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 70;
            if (nearBottom.current) setLatest(false);
          }
        }}
      >
        {!items.length && (
          <div className="chat-welcome">
            <div className="welcome-hero">
              <Mascot large state="static" />
              <div className="hero-star-badge" title="AI 伙伴">
                <Icon name="star" />
              </div>
            </div>
            <h1>从一个想法开始</h1>
            <p className="welcome-tagline">AI 队友 · 为你连接工具并推进真实成果</p>
            <div className="chat-starters" aria-label="开始对话">
              {['帮我安排今天的学习', '如何管理我的记忆？', '我可以连接哪些工具？'].map((text) => (
                <Button
                  variant="outline"
                  key={text}
                  onClick={() => {
                    chat.setDraft(text);
                    input.current?.focus();
                  }}
                >
                  <span>{text}</span>
                  <Icon name="arrow-right" />
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="chat-thread">
          {items.map((item, index) => (
            <div key={item.value.key}>
              {dividers[index] && (
                <p className="chat-time-divider" role="separator">
                  {groupLabel(item.createdAt)}
                </p>
              )}
              {item.kind === 'turn' ? (
                <Turn
                  turn={item.value}
                  retry={() => void chat.retryCreate(item.value)}
                  resume={() => void chat.resume(item.value)}
                />
              ) : (
                <article className="chat-turn widget-turn">
                  <div className="widget-turn-head">
                    <Icon name="plug" />
                    <span>
                      {item.value.pluginName} · {item.value.actionTitle}
                    </span>
                    <Badge variant={item.value.providerMode === 'live' ? 'success' : 'outline'}>
                      {item.value.providerMode === 'live' ? '实时数据' : 'Mock 数据'}
                    </Badge>
                  </div>
                  <div className="chat-bubble assistant-bubble">
                    <MessageContent text={item.value.summary} />
                  </div>
                  {item.value.widgets.map((widget) => (
                    <WidgetCard key={widget.widgetId} widget={widget} />
                  ))}
                </article>
              )}
            </div>
          ))}
        </div>
      </div>
      {latest && (
        <Button
          variant="secondary"
          size="icon"
          className="latest-button"
          aria-label="回到最新消息"
          title="回到最新消息"
          onClick={() => {
            if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
            nearBottom.current = true;
            setLatest(false);
          }}
        >
          <Icon name="arrow-down" />
        </Button>
      )}
      <div className="composer-dock">
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
            variant="ghost"
            size="icon"
            className="composer-add"
            aria-label="连接器"
            title="连接器"
            onClick={() => setConnectorsOpen(true)}
            disabled={chat.busy}
          >
            <Icon name="plus" />
          </Button>
          <label className="sr-only" htmlFor="chat-input">
            向 AVEN 提问
          </label>
          <textarea
            id="chat-input"
            ref={input}
            value={chat.draft}
            onChange={(event) => chat.setDraft(event.target.value)}
            placeholder="向 AVEN 提问…"
            disabled={!runtime}
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
          <div className="composer-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="voice-indicator-button"
              aria-label="语音模式"
              title="语音模式"
              disabled
            >
              <Icon name="mic" />
            </Button>
            {active ? (
              <Button
                type="button"
                size="icon"
                className="round-button send-button"
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
                className="round-button send-button"
                disabled={!runtime || !chat.draft.trim() || chat.busy}
                aria-label="发送消息"
              >
                <Icon name="arrow-up" />
              </Button>
            )}
          </div>
        </form>
        <p className="composer-note">
          {runtime?.providerMode === 'live'
            ? '真实模型 · 仅发送当前提问与获准上下文'
            : runtime
              ? 'Mock 模拟回复 · 不会执行外部操作'
              : '正在确认模型状态…'}
        </p>
      </div>
      {visible && connectorsOpen && (
        <Modal title="连接器" onClose={() => setConnectorsOpen(false)}>
          <ConnectorDialog
            onClose={() => setConnectorsOpen(false)}
            onExpired={onExpired}
            onResult={(result) => {
              setConnectorResults((current) => [...current, { ...result, createdAt: Date.now() }]);
              nearBottom.current = true;
              setConnectorsOpen(false);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
function Turn({ turn, retry, resume }: { turn: ChatTurn; retry: () => void; resume: () => void }) {
  const pending = ['sending', 'queued', 'running', 'cancelling'].includes(turn.status);
  return (
    <article className="chat-turn">
      <div className="message-user">
        <p className="chat-bubble user-bubble">{turn.input}</p>
      </div>
      {turn.answer && (
        <div className="message-assistant">
          <div className="assistant-avatar">
            <Mascot state="static" />
          </div>
          <div className="assistant-main">
            <div className="assistant-name">AVEN</div>
            <div className="assistant-body assistant-bubble">
              <MessageContent text={turn.answer} />
            </div>
            <div className="turn-actions">
              {turn.status === 'completed' && <CopyMessage text={turn.answer} />}
              {pending && (
                <span className="turn-state" role="status">
                  {labels[turn.status]}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {pending && !turn.answer && (
        <div className="reply-pending" role="status">
          <span className="reply-dot" />
          {labels[turn.status]}
        </div>
      )}
      {!pending && turn.status !== 'completed' && !turn.answer && (
        <span className="turn-state" role="status">
          {labels[turn.status]}
        </span>
      )}
      {turn.error && (
        <Alert variant="warning" className="my-2">
          {turn.error}
        </Alert>
      )}
      {turn.status === 'unknown' && (
        <Button variant="secondary" onClick={retry}>
          核对发送结果
        </Button>
      )}
      {turn.status === 'disconnected' && turn.runId && (
        <Button variant="secondary" onClick={resume}>
          重新读取回复
        </Button>
      )}
    </article>
  );
}
