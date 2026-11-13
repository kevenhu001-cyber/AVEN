'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentTurnRequest } from '@aven/contracts';
import { api, authExpired, errorText, writeUncertain, webCall } from './api';
export type ChatTurn = {
  key: string;
  input: string;
  answer: string;
  runId?: string;
  cursor: number;
  /** Local creation time (ms) for the timeline; not sent to the server. */
  createdAt: number;
  status:
    | 'sending'
    | 'unknown'
    | 'queued'
    | 'running'
    | 'cancelling'
    | 'completed'
    | 'cancelled'
    | 'failed'
    | 'disconnected';
  error?: string | undefined;
  request: AgentTurnRequest;
  cancelKey: string;
};
export function useAgentChat(suspended: boolean, onExpired: () => void) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const conversationId = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pendingText = useRef('');
  const pendingCursor = useRef(0);
  const frame = useRef<number | null>(null);
  const patch = useCallback(
    (key: string, change: Partial<ChatTurn>) =>
      setTurns((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item))),
    [],
  );
  const flushText = useCallback((key: string) => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const text = pendingText.current;
    if (!text) return;
    pendingText.current = '';
    setTurns((items) =>
      items.map((item) =>
        item.key === key
          ? {
              ...item,
              answer: item.answer + text,
              cursor: pendingCursor.current,
              status: 'running' as const,
            }
          : item,
      ),
    );
  }, []);
  const queueText = useCallback((key: string, text: string, cursor: number) => {
    pendingText.current += text;
    pendingCursor.current = cursor;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const chunk = pendingText.current;
      if (!chunk) return;
      pendingText.current = '';
      setTurns((items) =>
        items.map((item) =>
          item.key === key
            ? {
                ...item,
                answer: item.answer + chunk,
                cursor: pendingCursor.current,
                status: 'running' as const,
              }
            : item,
        ),
      );
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  const [previousSuspended, setPreviousSuspended] = useState(suspended);
  if (previousSuspended !== suspended) {
    setPreviousSuspended(suspended);
    if (suspended)
      setTurns((items) =>
        items.map((item) => ({
          ...item,
          answer: '',
          cursor: 0,
          status:
            item.runId && item.status !== 'failed' && item.status !== 'cancelled'
              ? 'disconnected'
              : item.status === 'sending'
                ? 'unknown'
                : item.status,
        })),
      );
  }
  useEffect(() => {
    if (!suspended) return;
    controller.current?.abort();
    pendingText.current = '';
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, [suspended]);

  async function stream(turn: ChatTurn, abort: AbortController) {
    pendingText.current = '';
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    try {
      for await (const event of api.agent.events(turn.runId!, turn.cursor, webCall(abort.signal))) {
        if (abort.signal.aborted || !mounted.current) return;
        const next: Partial<ChatTurn> = { cursor: event.sequence };
        if (event.type === 'message.delta') {
          if (event.text) queueText(turn.key, event.text, event.sequence);
          continue;
        }
        if (event.type === 'turn.started' || event.type.startsWith('tool.'))
          next.status = 'running';
        if (event.type === 'turn.completed') {
          next.status = 'completed';
        }
        if (event.type === 'turn.cancelled') {
          next.status = 'cancelled';
        }
        if (event.type === 'turn.failed') {
          next.status = 'failed';
          next.answer = '';
          next.error = '本次回复未完成，或来源授权已变化。请重新确认后发起新对话。';
        }
        if (
          event.type === 'turn.completed' ||
          event.type === 'turn.cancelled' ||
          event.type === 'turn.failed'
        )
          flushText(turn.key);
        patch(turn.key, next);
      }
    } catch (error) {
      if (authExpired(error)) {
        pendingText.current = '';
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }
        onExpired();
        return;
      }
      if (!mounted.current || abort.signal.aborted) return;
      pendingText.current = '';
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      // HTTP/source failures must not leave already-rendered derived text in a replay cache.
      patch(turn.key, {
        status: 'disconnected',
        ...(abort.signal.aborted ? {} : { answer: '', cursor: 0, error: errorText(error) }),
      });
    } finally {
      pending.current = false;
    }
  }
  async function create(turn: ChatTurn) {
    if (pending.current || suspended) return;
    pending.current = true;
    const abort = new AbortController();
    controller.current = abort;
    patch(turn.key, { status: 'sending', error: undefined });
    try {
      const result = await api.agent.createTurn(turn.request, turn.key, webCall(abort.signal));
      if (abort.signal.aborted || !mounted.current) {
        if (mounted.current) patch(turn.key, { status: 'unknown' });
        return;
      }
      conversationId.current = result.conversationId;
      const next = { ...turn, runId: result.runId, status: 'queued' as const };
      patch(turn.key, { runId: result.runId, status: 'queued' });
      await stream(next, abort);
    } catch (error) {
      if (authExpired(error)) onExpired();
      else if (mounted.current)
        patch(turn.key, {
          status: writeUncertain(error) ? 'unknown' : 'failed',
          error: errorText(error),
        });
    } finally {
      pending.current = false;
    }
  }
  function send(override?: string) {
    const text = (override ?? draft).trim();
    if (
      !text ||
      text.length > 8000 ||
      pending.current ||
      suspended ||
      turns.some((turn) =>
        ['sending', 'unknown', 'queued', 'running', 'cancelling'].includes(turn.status),
      )
    )
      return;
    const turn: ChatTurn = {
      key: crypto.randomUUID(),
      cancelKey: crypto.randomUUID(),
      input: text,
      answer: '',
      cursor: 0,
      createdAt: Date.now(),
      status: 'sending',
      request: {
        input: text,
        ...(conversationId.current ? { conversationId: conversationId.current } : {}),
      },
    };
    setTurns((items) => [...items, turn]);
    setDraft('');
    void create(turn);
  }
  async function resume(turn: ChatTurn) {
    if (pending.current || suspended || !turn.runId) return;
    pending.current = true;
    const abort = new AbortController();
    controller.current = abort;
    patch(turn.key, { status: 'queued', error: undefined });
    await stream(turn, abort);
  }
  async function cancel(turn: ChatTurn) {
    if (!turn.runId || suspended) return;
    patch(turn.key, { status: 'cancelling', error: undefined });
    try {
      const result = await api.agent.cancel(turn.runId, turn.cancelKey, webCall());
      if (
        result.status === 'cancelled' ||
        result.status === 'completed' ||
        result.status === 'failed'
      ) {
        controller.current?.abort();
        patch(turn.key, { status: result.status });
      }
    } catch (error) {
      if (authExpired(error)) onExpired();
      else patch(turn.key, { status: 'disconnected', error: errorText(error) });
    }
  }
  const busy = turns.some((turn) =>
    ['sending', 'unknown', 'queued', 'running', 'cancelling'].includes(turn.status),
  );
  function reset() {
    if (busy) return;
    controller.current?.abort();
    pendingText.current = '';
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setTurns([]);
    conversationId.current = undefined;
  }
  return { turns, draft, setDraft, send, resume, retryCreate: create, cancel, busy, reset };
}
