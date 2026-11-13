'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PluginManifest } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from './icon';
import { Mascot, type MascotState } from './mascot';
import { ConnectorAuthCard } from './halo/connector-auth-card';
import { Menu, RoundButton } from './halo/primitives';
import { countHighlights, highlightSegments, stepMatch } from './halo/text';
import { buildTimeline, isNearBottom, recallVisible } from './halo/timeline';
import type { AuthBook, ChatExtra } from './halo/types';
import { WidgetCard } from './plugins/widget-card';
import type { ChatTurn, useAgentChat } from './use-agent-chat';

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

const activeStatuses = ['sending', 'queued', 'running', 'cancelling'];

type Chat = ReturnType<typeof useAgentChat>;
type Item = { key: string; createdAt: number } & (
  { type: 'turn'; turn: ChatTurn } | { type: 'extra'; extra: ChatExtra }
);

/** Text with inline code and in-chat search highlights. `offset` is the global index of its first match. */
function RichText({
  text,
  query,
  offset,
  current,
}: {
  text: string;
  query: string;
  offset: number;
  current: number;
}) {
  const segments = highlightSegments(text, query, offset);
  return (
    <>
      {segments.map((segment, index) => {
        const content = segment.match ? (
          <mark
            className="halo-mark"
            data-match={segment.matchIndex}
            data-current={segment.matchIndex === current}
          >
            {segment.text}
          </mark>
        ) : (
          segment.text
        );
        return segment.code ? (
          <code key={index} className="halo-code">
            {content}
          </code>
        ) : (
          <Fragment key={index}>{content}</Fragment>
        );
      })}
    </>
  );
}

/** Vertical-only scroll inside the transcript; scrollIntoView would also shift overflow-hidden ancestors. */
function centerWithin(container: HTMLElement, target: HTMLElement) {
  const box = container.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const top = container.scrollTop + rect.top - box.top - (container.clientHeight - rect.height) / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

export function Chat({
  chat,
  suspended,
  active,
  botName,
  extras,
  plugins,
  auth,
  celebrate,
  searchRequest,
  onBack,
  onOpenProfile,
  onOpenApps,
  onNewChat,
  onShareTemplate,
  onRunAction,
  onUnavailable,
}: {
  chat: Chat;
  suspended: boolean;
  active: boolean;
  botName: string;
  extras: ChatExtra[];
  plugins: PluginManifest[];
  auth: AuthBook;
  celebrate: boolean;
  searchRequest: { query: string; seq: number } | null;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenApps: () => void;
  onNewChat: () => void;
  onShareTemplate: () => void;
  onRunAction: (plugin: PluginManifest, actionName: string) => void;
  onUnavailable: (message: string) => void;
}) {
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const header = useRef<HTMLElement>(null);
  const nearBottom = useRef(true);
  const [latest, setLatest] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [recall, setRecall] = useState(false);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const [lastSearchSeq, setLastSearchSeq] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (searchRequest && searchRequest.seq !== lastSearchSeq) {
    setLastSearchSeq(searchRequest.seq);
    setFinding(true);
    setQuery(searchRequest.query);
    setCurrent(0);
  }

  const items: Item[] = [
    ...chat.turns.map((turn) => ({
      key: turn.key,
      createdAt: turn.createdAt,
      type: 'turn' as const,
      turn,
    })),
    ...extras.map((extra) => ({
      key: extra.key,
      createdAt: extra.createdAt,
      type: 'extra' as const,
      extra,
    })),
  ];
  const timeline = buildTimeline(items, Math.max(now, ...items.map((item) => item.createdAt)));
  const lastUser = [...chat.turns].reverse()[0];
  const highlight = finding ? query : '';
  const offsets = new Map<string, number>();
  let total = 0;
  for (const entry of timeline)
    if (entry.kind === 'item' && entry.item.type === 'turn') {
      offsets.set(`${entry.key}:in`, total);
      total += countHighlights(entry.item.turn.input, highlight);
      offsets.set(`${entry.key}:out`, total);
      total += countHighlights(entry.item.turn.answer, highlight);
    }
  const activeTurn = [...chat.turns]
    .reverse()
    .find((turn) => ['queued', 'running', 'cancelling'].includes(turn.status));
  const latestTurn = chat.turns[chat.turns.length - 1];
  const mascotState: MascotState = celebrate
    ? 'happy'
    : chat.turns.some((turn) => activeStatuses.includes(turn.status))
      ? 'thinking'
      : latestTurn && ['failed', 'disconnected'].includes(latestTurn.status)
        ? 'sleepy'
        : 'idle';

  function measure() {
    const node = transcript.current;
    if (!node) return;
    nearBottom.current = isNearBottom(node.scrollHeight, node.scrollTop, node.clientHeight);
    if (nearBottom.current) setLatest(false);
    else if (node.scrollHeight > node.clientHeight + 120) setLatest(true);
    setScrolled(node.scrollTop > 4);
    const bubbles = node.querySelectorAll<HTMLElement>('.user-bubble');
    const last = bubbles[bubbles.length - 1];
    const top = node.getBoundingClientRect().top;
    setRecall(
      recallVisible(
        last ? last.getBoundingClientRect().bottom : null,
        top,
        header.current?.offsetHeight ?? 72,
      ),
    );
  }

  useLayoutEffect(() => {
    const node = transcript.current;
    if (!node) return;
    if (nearBottom.current) node.scrollTop = node.scrollHeight;
    else setLatest(true);
    // Scroll-linked header state is recomputed after content changes.
    measure();
  }, [chat.turns, extras]);

  useEffect(() => {
    const node = input.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, 156)}px`;
    }
  }, [chat.draft]);

  useEffect(() => {
    if (finding) findInput.current?.focus({ preventScroll: true });
  }, [finding]);

  useEffect(() => {
    if (!finding || !total) return;
    const node = transcript.current;
    const mark = node?.querySelector<HTMLElement>(`[data-match="${Math.min(current, total - 1)}"]`);
    if (node && mark) centerWithin(node, mark);
  }, [finding, current, total, query]);

  // Keep the hook mounted while private content is hidden during session checks.
  if (suspended) return null;

  const shown = Math.min(current, Math.max(total - 1, 0));

  function scrollToLatest() {
    const node = transcript.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    nearBottom.current = true;
    setLatest(false);
  }

  return (
    <section className="halo-chat" aria-label="与 AVEN 对话">
      <header ref={header} className="halo-chat-head" data-scrolled={scrolled}>
        <RoundButton icon="back" label="返回" onClick={onBack} />
        <button
          type="button"
          className="halo-bot-pill halo-press"
          onClick={onOpenProfile}
          aria-label={`查看 ${botName} 资料`}
        >
          <Mascot size={26} state={mascotState} />
          <span>{botName}</span>
        </button>
        <span className="halo-head-spacer" />
        {lastUser && (
          <button
            type="button"
            className="halo-recall"
            data-visible={recall && !finding}
            tabIndex={recall && !finding ? 0 : -1}
            aria-hidden={!(recall && !finding)}
            onClick={() => {
              const node = transcript.current;
              const bubbles = node?.querySelectorAll<HTMLElement>('.user-bubble');
              const last = bubbles?.[bubbles.length - 1];
              if (node && last) centerWithin(node, last);
            }}
          >
            {lastUser.input}
          </button>
        )}
        <Menu
          label="更多"
          items={[
            { id: 'profile', label: '查看资料', icon: 'profile', onSelect: onOpenProfile },
            {
              id: 'find',
              label: '在聊天中查找',
              icon: 'search',
              onSelect: () => {
                setFinding(true);
                setCurrent(0);
              },
            },
            { id: 'template', label: '分享为模板…', icon: 'upload', onSelect: onShareTemplate },
            {
              id: 'new',
              label: '新对话',
              icon: 'new-chat',
              onSelect: onNewChat,
              disabled: chat.busy,
            },
          ]}
        />
      </header>
      {finding && (
        <div className="halo-find" role="search">
          <Icon name="search" size={18} />
          <label className="sr-only" htmlFor="halo-find-input">
            在聊天中查找
          </label>
          <input
            id="halo-find-input"
            ref={findInput}
            value={query}
            placeholder="在聊天中查找"
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrent(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                setCurrent((value) => stepMatch(value, total, event.shiftKey ? -1 : 1));
              }
              if (event.key === 'Escape') setFinding(false);
            }}
          />
          <span className="halo-find-count" aria-live="polite">
            {query.trim() ? (total ? `${shown + 1}/${total}` : '无结果') : ''}
          </span>
          <button
            type="button"
            className="halo-find-step"
            aria-label="上一个"
            disabled={!total}
            onClick={() => setCurrent((v) => stepMatch(v, total, -1))}
          >
            <Icon name="up" size={18} />
          </button>
          <button
            type="button"
            className="halo-find-step"
            aria-label="下一个"
            disabled={!total}
            onClick={() => setCurrent((v) => stepMatch(v, total, 1))}
          >
            <Icon name="down" size={18} />
          </button>
          <button
            type="button"
            className="halo-text-button"
            onClick={() => {
              setFinding(false);
              setQuery('');
            }}
          >
            完成
          </button>
        </div>
      )}
      <div
        className="halo-transcript"
        ref={transcript}
        tabIndex={0}
        aria-label="对话内容"
        onScroll={measure}
      >
        {!timeline.length && (
          <div className="halo-chat-empty">
            <Mascot size={88} state="hello" />
            <h1>今天，想聊点什么？</h1>
            <p className="muted">从一个还没成形的想法开始也可以。</p>
            <p className="small muted">当前是确定性 Mock 回复，不代表真实模型能力。</p>
          </div>
        )}
        <div className="halo-thread">
          {timeline.map((entry) => {
            if (entry.kind === 'time')
              return (
                <p key={entry.key} className="halo-time">
                  {entry.label}
                </p>
              );
            const item = entry.item;
            if (item.type === 'turn') {
              const turn = item.turn;
              const waiting =
                ['sending', 'queued'].includes(turn.status) ||
                (turn.status === 'running' && !turn.answer);
              return (
                <article key={entry.key} className="chat-turn halo-turn">
                  <p className="chat-bubble user-bubble halo-enter">
                    <RichText
                      text={turn.input}
                      query={highlight}
                      offset={offsets.get(`${entry.key}:in`) ?? 0}
                      current={shown}
                    />
                  </p>
                  {turn.answer ? (
                    <p
                      className="chat-bubble assistant-bubble halo-enter"
                      data-streaming={turn.status === 'running'}
                    >
                      <RichText
                        text={turn.answer}
                        query={highlight}
                        offset={offsets.get(`${entry.key}:out`) ?? 0}
                        current={shown}
                      />
                    </p>
                  ) : (
                    waiting && (
                      <p className="halo-typing halo-enter" aria-label={labels[turn.status]}>
                        <span />
                        <span />
                        <span />
                      </p>
                    )
                  )}
                  <div className="turn-state" data-status={turn.status}>
                    <span>{labels[turn.status]}</span>
                    {turn.status === 'completed' && <span className="halo-turn-mode">· Mock</span>}
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
              );
            }
            const extra = item.extra;
            if (extra.kind === 'auth') {
              const plugin = plugins.find((candidate) => candidate.id === extra.pluginId);
              if (!plugin) return null;
              return (
                <article key={entry.key} className="chat-turn halo-turn halo-enter">
                  <ConnectorAuthCard
                    plugin={plugin}
                    state={auth.states[plugin.id] ?? 'idle'}
                    botName={botName}
                    onRequest={() => auth.dispatch(plugin.id, 'request')}
                    onCancel={() => auth.dispatch(plugin.id, 'cancel')}
                    onConfirm={() => auth.dispatch(plugin.id, 'confirm')}
                    onDisconnect={() => auth.dispatch(plugin.id, 'disconnect')}
                    onRunAction={(name) => onRunAction(plugin, name)}
                  />
                  <p className="chat-bubble assistant-bubble halo-local-note">
                    {auth.states[plugin.id] === 'connected'
                      ? `${plugin.name} 已在本页模拟连接。点上方的动作即可用 Mock 数据试用。`
                      : `请在卡片上完成 ${plugin.name} 授权，连上后就能在对话里调用它。`}
                    <span className="halo-local-tag">本页提示 · 非模型回复</span>
                  </p>
                </article>
              );
            }
            return (
              <article key={entry.key} className="chat-turn widget-turn halo-turn halo-enter">
                <div className="widget-turn-head">
                  <span>
                    {extra.pluginName} · {extra.actionTitle}
                  </span>
                  <Badge variant={extra.providerMode === 'live' ? 'success' : 'warning'}>
                    {extra.providerMode === 'live' ? '实时数据' : 'Mock 数据'}
                  </Badge>
                </div>
                <p className="chat-bubble assistant-bubble">{extra.summary}</p>
                {extra.widgets.map((widget) => (
                  <WidgetCard key={widget.widgetId} widget={widget} />
                ))}
              </article>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="halo-latest halo-press"
        data-visible={latest}
        tabIndex={latest ? 0 : -1}
        aria-hidden={!latest}
        aria-label="回到最新消息"
        onClick={scrollToLatest}
      >
        <Icon name="down" size={22} />
      </button>
      <form
        className="halo-composer"
        onSubmit={(event) => {
          event.preventDefault();
          nearBottom.current = true;
          chat.send();
        }}
      >
        <button
          type="button"
          className="halo-composer-plus halo-press"
          aria-label="连接器"
          title="连接应用"
          onClick={onOpenApps}
          disabled={chat.busy}
        >
          <Icon name="plus" size={24} />
        </button>
        <label className="sr-only" htmlFor="chat-input">
          向 AVEN 提问
        </label>
        <textarea
          id="chat-input"
          ref={input}
          value={chat.draft}
          onChange={(event) => chat.setDraft(event.target.value)}
          placeholder={`向 ${botName} 提问`}
          maxLength={8000}
          rows={1}
          tabIndex={active ? 0 : -1}
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
        <button
          type="button"
          className="halo-composer-mic halo-press"
          aria-label="语音输入（尚未开放）"
          aria-disabled="true"
          onClick={() => onUnavailable('语音输入尚未开放。')}
        >
          <Icon name="mic" size={22} />
        </button>
        {activeTurn ? (
          <button
            key="stop"
            type="button"
            className="halo-composer-go halo-swap halo-press"
            disabled={activeTurn.status === 'cancelling'}
            onClick={() => void chat.cancel(activeTurn)}
            aria-label="停止回复"
          >
            <Icon name="square" size={18} />
          </button>
        ) : chat.draft.trim() ? (
          <button
            key="send"
            type="submit"
            className="halo-composer-go halo-swap halo-press"
            disabled={chat.busy}
            aria-label="发送消息"
          >
            <Icon name="arrow-up" size={22} />
          </button>
        ) : (
          <button
            key="voice"
            type="button"
            className="halo-composer-go halo-swap halo-press"
            aria-label="语音对话（尚未开放）"
            aria-disabled="true"
            onClick={() => onUnavailable('语音对话尚未开放；可以先用文字提问。')}
          >
            <Icon name="wave" size={22} />
          </button>
        )}
      </form>
    </section>
  );
}
