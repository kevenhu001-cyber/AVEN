import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { AgentHistoryItem, AgentTurnRequest } from '@aven/contracts';
import { useSession } from './session';
import { expired, problemText, uncertain } from './api';
import {
  Action,
  ChatBubble,
  Composer,
  Copy,
  Loading,
  Mascot,
  Page,
  Problem,
  TimeDivider,
  usePalette,
} from './ui';
import { ConnectorScreen } from './connector-screen';
import { NativeWidget } from './widget-card';
import type { PluginInvokeResponse } from '@aven/contracts';
import { dayDividers, groupLabel } from './time-label';

type Turn = {
  key: string;
  cancelKey: string;
  request: AgentTurnRequest;
  runId?: string;
  createdAt: number;
  answer: string;
  status: string;
  problem?: string;
};
const statuses: Record<string, string> = {
  sending: '正在确认发送',
  unknown: '发送结果未确认',
  queued: '等待回复',
  running: '正在生成',
  cancelling: '正在停止',
  completed: '回复完成',
  cancelled: '已停止',
  failed: '未完成',
  disconnected: '读取已断开',
};
export type ChatScreenHandle = {
  newChat: () => void;
  openHistory: () => void;
  openConnectors: () => void;
};
export function ChatScreen({ ref }: { ref?: Ref<ChatScreenHandle> }) {
  const { api, call, invalidate } = useSession();
  const palette = usePalette();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [plugins, setPlugins] = useState(false);
  const [results, setResults] = useState<PluginInvokeResponse[]>([]);
  const [history, setHistory] = useState<AgentHistoryItem[] | null>(null);
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [message, setMessage] = useState('');
  const conversation = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const cancellation = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      cancellation.current?.abort();
    };
  }, []);
  useImperativeHandle(ref, () => ({
    newChat() {
      if (lock.current) return;
      setTurns([]);
      setResults([]);
      setHistory(null);
      conversation.current = undefined;
      setDraft('');
    },
    openHistory() {
      setHistory([]);
    },
    openConnectors() {
      setPlugins(true);
    },
  }));
  function patch(key: string, change: Partial<Turn>) {
    if (mounted.current)
      setTurns((old) => old.map((turn) => (turn.key === key ? { ...turn, ...change } : turn)));
  }
  async function stream(turn: Turn, abort: AbortController) {
    try {
      for await (const event of api.agent.events(turn.runId!, 0, call(abort.signal))) {
        if (abort.signal.aborted || !mounted.current) return;
        if (event.type === 'message.delta')
          setTurns((old) =>
            old.map((item) =>
              item.key === turn.key
                ? { ...item, answer: item.answer + (event.text ?? ''), status: 'running' }
                : item,
            ),
          );
        if (event.type === 'turn.started' || event.type.startsWith('tool.'))
          patch(turn.key, { status: 'running' });
        if (event.type === 'turn.completed') patch(turn.key, { status: 'completed' });
        if (event.type === 'turn.cancelled') patch(turn.key, { status: 'cancelled' });
        if (event.type === 'turn.failed')
          patch(turn.key, {
            status: 'failed',
            answer: '',
            problem: '回复未完成或来源授权已变化。',
          });
      }
    } catch (error) {
      if (expired(error)) invalidate();
      else if (!abort.signal.aborted)
        patch(turn.key, { status: 'disconnected', answer: '', problem: problemText(error) });
    }
  }
  async function create(turn: Turn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    patch(turn.key, { status: 'sending', problem: '' });
    try {
      const result = await api.agent.createTurn(turn.request, turn.key, call(abort.signal));
      if (abort.signal.aborted) return;
      conversation.current = result.conversationId;
      const next = { ...turn, runId: result.runId, status: 'queued' };
      patch(turn.key, { runId: result.runId, status: 'queued' });
      await stream(next, abort);
    } catch (error) {
      if (expired(error)) invalidate();
      else if (!abort.signal.aborted)
        patch(turn.key, {
          status: uncertain(error) ? 'unknown' : 'failed',
          problem: problemText(error),
        });
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function replay(turn: Turn) {
    if (lock.current || !turn.runId) return;
    lock.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    patch(turn.key, { answer: '', status: 'queued', problem: '' });
    await stream(turn, abort);
    lock.current = false;
    if (mounted.current) setBusy(false);
  }
  async function loadHistory(more = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await api.agent.history(
        more && cursor ? { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id } : {},
        call(abort.signal),
      );
      if (!abort.signal.aborted) {
        setHistory((old) => (more ? [...(old ?? []), ...result.data] : result.data));
        setCursor(result.nextCursor);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (expired(error)) invalidate();
        else setMessage(problemText(error));
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const active = turns.find((turn) => ['queued', 'running', 'cancelling'].includes(turn.status));
  const unresolved = turns.some((turn) =>
    ['unknown', 'sending', 'queued', 'running', 'cancelling'].includes(turn.status),
  );
  function cancel(target: Turn) {
    if (!target.runId) return;
    patch(target.key, { status: 'cancelling' });
    const abort = new AbortController();
    cancellation.current = abort;
    void api.agent
      .cancel(target.runId, target.cancelKey, call(abort.signal))
      .then((result) => {
        if (abort.signal.aborted || !mounted.current) return;
        if (['completed', 'failed', 'cancelled'].includes(result.status)) {
          controller.current?.abort();
          patch(target.key, {
            status: result.status,
            ...(result.status === 'failed' ? { answer: '' } : {}),
          });
        }
      })
      .catch((error) => {
        if (abort.signal.aborted || !mounted.current) return;
        if (expired(error)) invalidate();
        else
          setTurns((old) =>
            old.map((turn) =>
              turn.key === target.key && turn.status === 'cancelling'
                ? { ...turn, status: 'running', problem: problemText(error) }
                : turn,
            ),
          );
      });
  }
  if (plugins)
    return (
      <ConnectorScreen
        onBack={() => setPlugins(false)}
        onResult={(result) => {
          setResults((old) => [...old, result]);
          setPlugins(false);
        }}
      />
    );
  if (history)
    return (
      <HistoryScreen
        items={history}
        cursor={cursor}
        busy={busy}
        message={message}
        onBack={() => setHistory(null)}
        onMore={() => void loadHistory(true)}
        onReload={() => void loadHistory()}
        onReplay={(item) => {
          const turn: Turn = {
            key: Crypto.randomUUID(),
            cancelKey: Crypto.randomUUID(),
            request: { input: '历史回复' },
            runId: item.id,
            createdAt: Date.now(),
            answer: '',
            status: 'queued',
          };
          setTurns([turn]);
          conversation.current = undefined;
          setHistory(null);
          void replay(turn);
        }}
      />
    );
  const ordered = [...turns].sort((a, b) => a.createdAt - b.createdAt);
  const dividers = dayDividers(ordered.map((turn) => turn.createdAt));
  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={chatContent}>
        {ordered.length === 0 && results.length === 0 && (
          <View style={emptyState}>
            <Mascot />
            <Copy title>有什么可以帮你？</Copy>
            <Copy muted>AI 队友 · 为你连接工具并推进真实成果</Copy>
            <View style={starterWrap}>
              {['帮我安排今天的学习', '如何管理我的记忆？', '我可以连接哪些工具？'].map((text) => (
                <Pressable
                  key={text}
                  accessibilityRole="button"
                  onPress={() => setDraft(text)}
                  style={({ pressed }) => [
                    starter,
                    { borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={{ color: palette['text-secondary'], fontSize: 13 }}>{text}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {busy && !active && <Loading />}
        {ordered.map((turn, index) => (
          <View key={turn.key}>
            {dividers[index] && <TimeDivider>{groupLabel(turn.createdAt)}</TimeDivider>}
            <ChatBubble role="user">{turn.request.input}</ChatBubble>
            {!!turn.answer && <ChatBubble role="assistant">{turn.answer}</ChatBubble>}
            {turn.status !== 'completed' && (
              <View style={statusRow}>
                <Copy muted>{statuses[turn.status] ?? turn.status}</Copy>
              </View>
            )}
            {turn.problem && <Problem message={turn.problem} />}
            {turn.status === 'unknown' && (
              <Action secondary disabled={busy} onPress={() => void create(turn)}>
                沿用本次请求核对发送结果
              </Action>
            )}
            {turn.status === 'disconnected' && (
              <Action secondary disabled={busy} onPress={() => void replay(turn)}>
                重新验证并读取回复
              </Action>
            )}
          </View>
        ))}
        {results.map((result) => (
          <View key={result.invocationId}>
            <ChatBubble role="assistant">{result.summary}</ChatBubble>
            {result.widgets.map((widget) => (
              <NativeWidget key={widget.widgetId} widget={widget} />
            ))}
          </View>
        ))}
      </ScrollView>
      {message ? (
        <View style={footerNote}>
          <Problem message={message} />
        </View>
      ) : null}
      <Composer
        value={draft}
        onChangeText={setDraft}
        busy={busy}
        disabled={unresolved}
        onPlugins={() => setPlugins(true)}
        onSend={() => {
          const turn: Turn = {
            key: Crypto.randomUUID(),
            cancelKey: Crypto.randomUUID(),
            request: {
              input: draft.trim(),
              ...(conversation.current ? { conversationId: conversation.current } : {}),
            },
            createdAt: Date.now(),
            answer: '',
            status: 'sending',
          };
          setTurns((old) => [...old, turn]);
          setDraft('');
          void create(turn);
        }}
        onStop={() => {
          const target = turns.find((turn) =>
            ['queued', 'running', 'cancelling'].includes(turn.status),
          );
          if (target) cancel(target);
        }}
      />
    </View>
  );
}

/* 参考图 2：空态使用大圆形角色与名称，而不是表单列表。 */
const emptyState = {
  alignItems: 'center' as const,
  paddingTop: 64,
  paddingHorizontal: 8,
  gap: 8,
};
const starterWrap = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  justifyContent: 'center' as const,
  gap: 8,
  marginTop: 18,
};
const starter = { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 };
const chatContent = { padding: 16, gap: 0, paddingBottom: 12 };
const statusRow = { paddingBottom: 4, paddingLeft: 2 };
const footerNote = { paddingHorizontal: 16, paddingBottom: 6 };

function HistoryScreen({
  items,
  cursor,
  busy,
  message,
  onBack,
  onMore,
  onReload,
  onReplay,
}: {
  items: AgentHistoryItem[];
  cursor: { createdAt: string; id: string } | null;
  busy: boolean;
  message: string;
  onBack: () => void;
  onMore: () => void;
  onReload: () => void;
  onReplay: (item: AgentHistoryItem) => void;
}) {
  return (
    <Page>
      <Action secondary onPress={onBack}>
        返回对话
      </Action>
      <Copy title>对话记录</Copy>
      <Copy muted>
        只列元数据。回复需重新验证来源授权，仅支持 24 小时内重读，不恢复用户输入或连接器结果。
      </Copy>
      <Problem message={message} />
      <Action secondary disabled={busy} onPress={onReload}>
        刷新记录
      </Action>
      {items.length === 0 && <Copy muted>暂无记录。</Copy>}
      {items.map((item) => (
        <Action key={item.id} secondary disabled={busy} onPress={() => onReplay(item)}>
          {new Date(item.createdAt).toLocaleString('zh-CN')} · {item.status}
        </Action>
      ))}
      {cursor && (
        <Action secondary disabled={busy} onPress={onMore}>
          更早的记录
        </Action>
      )}
    </Page>
  );
}
