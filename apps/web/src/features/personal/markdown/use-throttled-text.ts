'use client';

import { useEffect, useRef, useState } from 'react';

/** Longest gap between Markdown reparses while a reply streams. */
const MAX_WAIT_MS = 2000;
/** Allow the next parse only after the previous render has had this much time again. */
const COST_MULTIPLIER = 2;

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

type Frame = { text: string; streaming: true };

/**
 * Batch expensive Markdown parses while text arrives token by token. The first
 * update is immediate; afterwards a parse is scheduled for (previous render
 * duration × COST_MULTIPLIER), capped at MAX_WAIT_MS. When streaming stops the
 * latest text is returned directly so the final reply is never stale.
 */
export function useThrottledText(content: string, enabled: boolean): string {
  const [frame, setFrame] = useState<Frame | null>(null);
  const startedAt = useRef<number | null>(null);
  const nextAllowedAt = useRef(0);

  // A new stream restarts the cost estimate; frames from the previous one must
  // not delay the first parse of this one.
  useEffect(() => {
    if (!enabled) {
      startedAt.current = null;
      nextAllowedAt.current = 0;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const delay = startedAt.current === null ? 0 : Math.max(0, nextAllowedAt.current - now());
    const timer = window.setTimeout(() => {
      startedAt.current = now();
      setFrame({ text: content, streaming: true });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [content, enabled]);

  // Cost of the frame that just committed decides when the next one may run.
  useEffect(() => {
    if (!enabled || frame === null) return;
    const at = now();
    const started = startedAt.current ?? at;
    nextAllowedAt.current = at + Math.min(MAX_WAIT_MS, Math.max(0, at - started) * COST_MULTIPLIER);
  }, [frame, enabled]);

  // Outside streaming, or before this stream's first frame, show the live text.
  return enabled && frame?.streaming ? frame.text : content;
}
