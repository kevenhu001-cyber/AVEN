import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { AgentHistoryItem, AgentTurnRequest } from '@aven/contracts';
import { useSession } from './session';
import { expired, problemText, uncertain } from './api';
import { Action, Card, Copy, Field, Loading, Mascot, Page, Problem } from './ui';
import { ConnectorScreen } from './connector-screen';
import { NativeWidget } from './widget-card';
import type { PluginInvokeResponse } from '@aven/contracts';

type Turn = {
  key: string;
  cancelKey: string;
  request: AgentTurnRequest;
  runId?: string;
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
export function ChatScreen() {
  const { api, call, invalidate } = useSession();
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
  return (
    <Page>
      <Mascot />
      <Copy title>今天，想聊点什么？</Copy>
      <Copy muted>AI · Mock。确定性回复不代表真实模型能力。</Copy>
      <Problem message={message} />
      <Action
        secondary
        disabled={busy || unresolved}
        onPress={() => {
          setTurns([]);
          setResults([]);
          setHistory(null);
          conversation.current = undefined;
        }}
      >
        新对话
      </Action>
      <Action secondary disabled={busy || unresolved} onPress={() => void loadHistory()}>
        对话记录
      </Action>
      {history && (
        <Card>
          <Copy title>运行记录</Copy>
          <Copy muted>
            只列元数据。回复需重新验证来源授权，仅支持 24 小时内重读，不恢复用户输入或连接器结果。
          </Copy>
          {history.length === 0 && <Copy>暂无记录。</Copy>}
          {history.map((item) => (
            <Action
              key={item.id}
              secondary
              disabled={busy || unresolved}
              onPress={() => {
                const turn: Turn = {
                  key: Crypto.randomUUID(),
                  cancelKey: Crypto.randomUUID(),
                  request: { input: '历史回复' },
                  runId: item.id,
                  answer: '',
                  status: 'queued',
                };
                setTurns([turn]);
                conversation.current = undefined;
                setHistory(null);
                void replay(turn);
              }}
            >
              {new Date(item.createdAt).toLocaleString('zh-CN')} · {item.status}
            </Action>
          ))}
          {cursor && (
            <Action secondary disabled={busy} onPress={() => void loadHistory(true)}>
              更早的记录
            </Action>
          )}
        </Card>
      )}
      {turns.map((turn) => (
        <Card key={turn.key}>
          <Copy>{turn.request.input}</Copy>
          {!!turn.answer && <Copy>{turn.answer}</Copy>}
          <Copy muted>{statuses[turn.status] ?? turn.status}</Copy>
          <Problem message={turn.problem ?? ''} />
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
        </Card>
      ))}
      {results.map((result) => (
        <Card key={result.invocationId}>
          <Copy>{result.summary}</Copy>
          {result.widgets.map((widget) => (
            <NativeWidget key={widget.widgetId} widget={widget} />
          ))}
        </Card>
      ))}
      {busy && <Loading />}
      {active && (
        <Action
          secondary
          disabled={active.status === 'cancelling'}
          onPress={() => {
            patch(active.key, { status: 'cancelling' });
            const abort = new AbortController();
            cancellation.current = abort;
            void api.agent
              .cancel(active.runId!, active.cancelKey, call(abort.signal))
              .then((result) => {
                if (abort.signal.aborted || !mounted.current) return;
                if (['completed', 'failed', 'cancelled'].includes(result.status)) {
                  controller.current?.abort();
                  patch(active.key, {
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
                      turn.key === active.key && turn.status === 'cancelling'
                        ? { ...turn, status: 'running', problem: problemText(error) }
                        : turn,
                    ),
                  );
              });
          }}
        >
          停止回复
        </Action>
      )}
      <Field
        label="向 AVEN 提问"
        value={draft}
        onChangeText={setDraft}
        multiline
        maxLength={8000}
        editable={!busy && !unresolved}
      />
      <Action
        testID="chat-send"
        disabled={busy || unresolved || !draft.trim()}
        onPress={() => {
          const turn: Turn = {
            key: Crypto.randomUUID(),
            cancelKey: Crypto.randomUUID(),
            request: {
              input: draft.trim(),
              ...(conversation.current ? { conversationId: conversation.current } : {}),
            },
            answer: '',
            status: 'sending',
          };
          setTurns((old) => [...old, turn]);
          setDraft('');
          void create(turn);
        }}
      >
        发送消息
      </Action>
      <Action secondary disabled={busy || unresolved} onPress={() => setPlugins(true)}>
        连接器
      </Action>
    </Page>
  );
}
