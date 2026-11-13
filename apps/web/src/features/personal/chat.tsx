'use client';

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import type { ChatExtra } from './halo/types';
import { WidgetCard } from './plugins/widget-card';
import { MarkdownMessage } from './markdown/message';
import { countMarkdownHighlights } from './markdown/text';
import 'katex/dist/katex.min.css';
import './markdown/message.css';
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
const RichText = memo(function RichText({
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
});

/** Vertical-only scroll inside the transcript; scrollIntoView would also shift overflow-hidden ancestors. */
function centerWithin(container: HTMLElement, target: HTMLElement) {
  const box = container.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const top = container.scrollTop + rect.top - box.top - (container.clientHeight - rect.height) / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function CopyButton({
  text,
  onUnavailable,
}: {
  text: string;
  onUnavailable: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="halo-msg-action"
      aria-label={copied ? '已复制回复' : '复制回复'}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => {
            setCopied(false);
            onUnavailable('无法访问剪贴板，请手动选择文本。');
          });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {copied ? '已复制' : '复制'}
    </button>
  );
}

export function Chat({
  chat,
  suspended,
  active,
  botName,
  extras,
  plugins,
  connectorStatus,
  celebrate,
  searchRequest,
  onBack,
  onOpenProfile,
  onOpenApps,
  onOpenConnector,
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
  connectorStatus: (pluginId: string) => string | undefined;
  celebrate: boolean;
  searchRequest: { query: string; seq: number } | null;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenApps: () => void;
  onOpenConnector: (plugin: PluginManifest) => void;
  onNewChat: () => void;
  onShareTemplate: () => void;
  onRunAction: (plugin: PluginManifest, actionName: string) => void;
  onUnavailable: (message: string) => void;
}) {
  const transcript = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
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
  const [seenSearch, setSeenSearch] = useState<{ query: string; seq: number } | null>(null);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const seenAnswers = useRef(0);
  // An entrance animation belongs to content added after this screen mounted. Re-opening an
  // existing conversation must not replay every bubble, and a running reply must still pop in
  // when its first token arrives (so freshness is tracked per turn, not read from status).
  // The container is initialised once from the first render and only used to decide motion.
  const [animationState] = useState(() => ({
    known: {
      turns: new Set(chat.turns.map((turn) => turn.key)),
      answers: new Set(chat.turns.filter((turn) => turn.answer).map((turn) => turn.key)),
      extras: new Set(extras.map((extra) => extra.key)),
    },
    fresh: {
      turns: new Set<string>(),
      answers: new Set<string>(),
      extras: new Set<string>(),
    },
  }));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setFinding(true);
        setCurrent(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!finding) return;
    const onKey = (event: KeyboardEvent) => {
      // Menus and sheets handle Escape first and mark the event as prevented.
      if (event.key === 'Escape' && !event.defaultPrevented) setFinding(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finding]);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    input.current?.focus({ preventScroll: true });
  }, []);

  // A render-phase update (not an effect) so a search query from the URL opens the find bar
  // in the same commit, including when the chat page stays mounted across query changes.
  if (searchRequest && searchRequest !== seenSearch) {
    setSeenSearch(searchRequest);
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
  function freshTurn(key: string) {
    if (!animationState.known.turns.has(key)) {
      animationState.known.turns.add(key);
      animationState.fresh.turns.add(key);
    }
    return animationState.fresh.turns.has(key);
  }
  function freshAnswer(turn: ChatTurn) {
    if (!turn.answer) return false;
    if (!animationState.known.answers.has(turn.key)) {
      animationState.known.answers.add(turn.key);
      animationState.fresh.answers.add(turn.key);
    }
    return animationState.fresh.answers.has(turn.key);
  }
  function freshExtra(key: string) {
    if (!animationState.known.extras.has(key)) {
      animationState.known.extras.add(key);
      animationState.fresh.extras.add(key);
    }
    return animationState.fresh.extras.has(key);
  }
  const answerCount = chat.turns.reduce((count, turn) => count + (turn.answer ? 1 : 0), 0);
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
      total += countMarkdownHighlights(entry.item.turn.answer, highlight);
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

  const measure = useCallback(() => {
    const node = transcript.current;
    if (!node) return;
    nearBottom.current = isNearBottom(node.scrollHeight, node.scrollTop, node.clientHeight);
    if (nearBottom.current) {
      setLatest(false);
      seenAnswers.current = answerCount;
      setUnread(0);
    } else {
      if (node.scrollHeight > node.clientHeight + 120) setLatest(true);
      setUnread(Math.max(0, answerCount - seenAnswers.current));
    }
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
  }, [answerCount]);

  useLayoutEffect(() => {
    const node = transcript.current;
    if (!node) return;
    if (nearBottom.current) {
      node.scrollTop = node.scrollHeight;
      seenAnswers.current = answerCount;
      setUnread(0);
    }
    // Scroll-linked header state is recomputed after content changes.
    measure();
  }, [chat.turns, extras, answerCount, measure]);

  // Mermaid diagrams, images and late layout changes grow the thread after the
  // turn list stops changing. Keep the view pinned only when it was at the
  // bottom, so a reader who scrolled up is not pulled back.
  useEffect(() => {
    const node = transcript.current;
    const content = thread.current;
    if (!node || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

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
    seenAnswers.current = answerCount;
    setLatest(false);
    setUnread(0);
  }

  return (
    <section className="halo-chat" aria-label="与 AVEN 对话" aria-busy={chat.busy}>
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
            <div className="halo-quick-prompts">
              {['帮我整理今天的想法', '我最近在忙什么？', '连接 Gmail'].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="halo-chip"
                  onClick={() => chat.send(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="halo-thread" ref={thread}>
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
              const userFresh = freshTurn(turn.key);
              const answerFresh = freshAnswer(turn);
              const waiting =
                ['sending', 'queued'].includes(turn.status) ||
                (turn.status === 'running' && !turn.answer);
              return (
                <article
                  key={entry.key}
                  className="chat-turn halo-turn"
                  data-fresh={userFresh ? 'true' : undefined}
                >
                  <p
                    className="chat-bubble user-bubble"
                    data-fresh={userFresh ? 'true' : undefined}
                  >
                    <RichText
                      text={turn.input}
                      query={highlight}
                      offset={offsets.get(`${entry.key}:in`) ?? 0}
                      current={shown}
                    />
                  </p>
                  {turn.answer ? (
                    <div
                      className="chat-bubble assistant-bubble"
                      data-streaming={turn.status === 'running'}
                      data-fresh={answerFresh ? 'true' : undefined}
                    >
                      <MarkdownMessage
                        text={turn.answer}
                        query={highlight}
                        offset={offsets.get(`${entry.key}:out`) ?? 0}
                        current={shown}
                        animate={answerFresh}
                        streaming={turn.status === 'running'}
                      />
                    </div>
                  ) : (
                    waiting && (
                      <p
                        className="halo-typing"
                        aria-label={labels[turn.status]}
                        data-fresh={userFresh ? 'true' : undefined}
                      >
                        <span />
                        <span />
                        <span />
                      </p>
                    )
                  )}
                  <div className="halo-turn-meta" data-fresh={userFresh ? 'true' : undefined}>
                    <div className="turn-state" data-status={turn.status} aria-live="polite">
                      <span>{labels[turn.status]}</span>
                    </div>
                    {turn.answer && !activeStatuses.includes(turn.status) && (
                      <CopyButton text={turn.answer} onUnavailable={onUnavailable} />
                    )}
                    {(turn.status === 'failed' || turn.status === 'cancelled') && (
                      <button
                        type="button"
                        className="halo-msg-action"
                        aria-label="重新发送这条提问"
                        onClick={() => chat.send(turn.input)}
                      >
                        <Icon name="refresh" size={14} />
                        再试一次
                      </button>
                    )}
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
            const extraFresh = freshExtra(item.key);
            if (extra.kind === 'auth') {
              const plugin = plugins.find((candidate) => candidate.id === extra.pluginId);
              if (!plugin) return null;
              return (
                <article
                  key={entry.key}
                  className="chat-turn halo-turn halo-enter"
                  data-fresh={extraFresh ? 'true' : undefined}
                >
                  <ConnectorAuthCard
                    plugin={plugin}
                    status={connectorStatus(plugin.id)}
                    botName={botName}
                    onAuthorize={() => onOpenConnector(plugin)}
                    onRunAction={(name) => onRunAction(plugin, name)}
                  />
                  <p
                    className="chat-bubble assistant-bubble halo-local-note"
                    data-fresh={extraFresh ? 'true' : undefined}
                  >
                    {connectorStatus(plugin.id) === 'connected'
                      ? `${plugin.name} 已通过网关连接。`
                      : `前往账号连接页完成 ${plugin.name} 的真实授权。`}
                    <span className="halo-local-tag">本页提示 · 非模型回复</span>
                  </p>
                </article>
              );
            }
            return (
              <article
                key={entry.key}
                className="chat-turn widget-turn halo-turn halo-enter"
                data-fresh={extraFresh ? 'true' : undefined}
              >
                <div className="widget-turn-head">
                  <span>
                    {extra.pluginName} · {extra.actionTitle}
                  </span>
                  <Badge variant={extra.providerMode === 'live' ? 'success' : 'warning'}>
                    {extra.providerMode === 'live' ? '实时数据' : '样例数据'}
                  </Badge>
                </div>
                <p
                  className="chat-bubble assistant-bubble"
                  data-fresh={extraFresh ? 'true' : undefined}
                >
                  {extra.summary}
                </p>
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
        data-visible={latest || unread > 0}
        data-unread={unread > 0}
        tabIndex={latest || unread > 0 ? 0 : -1}
        aria-hidden={!(latest || unread > 0)}
        aria-label={unread > 0 ? `回到最新消息，${unread} 条新回复` : '回到最新消息'}
        onClick={scrollToLatest}
      >
        <Icon name="down" size={22} />
        {unread > 0 && (
          <span className="halo-latest-count" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <form
        className="halo-composer"
        onSubmit={(event) => {
          event.preventDefault();
          nearBottom.current = true;
          chat.send();
        }}
      >
        {chat.draft.length > 7000 && (
          <span
            className="halo-composer-count"
            data-limit={chat.draft.length >= 8000 ? 'true' : undefined}
            aria-live="polite"
          >
            {chat.draft.length}/8000
          </span>
        )}
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
