export type SseEvent = { event: string; data: string; id?: string };

/** Transport parsing only. This does not create/retry an Agent run or execute actions. */
export async function* readSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  let event = 'message';
  let id: string | undefined;
  let eventLength = 0;
  const limit = 65536;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error('SSE_CANCELLED');
      const chunk = await reader.read();
      if (signal?.aborted) throw new Error('SSE_CANCELLED');
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      while (true) {
        const end = pending.search(/[\r\n]/);
        if (end < 0 || (!chunk.done && pending[end] === '\r' && end === pending.length - 1)) break;
        const line = pending.slice(0, end);
        const width = pending[end] === '\r' && pending[end + 1] === '\n' ? 2 : 1;
        pending = pending.slice(end + width);
        eventLength += line.length;
        if (eventLength > limit) throw new Error('SSE_EVENT_TOO_LARGE');
        if (!line) {
          if (data.length)
            yield { event, data: data.join('\n'), ...(id === undefined ? {} : { id }) };
          data = [];
          event = 'message';
          eventLength = 0;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') data.push(value);
        else if (field === 'event') event = value || 'message';
        else if (field === 'id' && !value.includes('\0')) id = value;
      }
      if (pending.length + eventLength > limit) throw new Error('SSE_EVENT_TOO_LARGE');
      // SSE dispatch requires a blank line; an incomplete EOF frame is not fabricated.
      if (chunk.done) break;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
