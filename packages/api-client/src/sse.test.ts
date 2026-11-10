import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { readSse } from './sse';

function fromBytes(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('SSE transport probe, not an Agent implementation', () => {
  it('parses UTF-8 across single-byte chunks, CRLF boundaries, comments and multiline data', async () => {
    const input = new TextEncoder().encode(
      ': heartbeat\r\nid: 2\r\nevent: message.delta\r\ndata: 中文\r\ndata: next\r\n\r\n',
    );
    const events = [];
    for await (const event of readSse(fromBytes([...input].map((byte) => Uint8Array.of(byte)))))
      events.push(event);
    expect(events).toEqual([{ id: '2', event: 'message.delta', data: '中文\nnext' }]);
  });
  it('discards incomplete EOF frames instead of fabricating completion', async () => {
    const events = [];
    for await (const event of readSse(fromBytes([new TextEncoder().encode('data: unfinished')])))
      events.push(event);
    expect(events).toEqual([]);
  });
  it('caps frame accumulation', async () => {
    const iterator = readSse(fromBytes([new TextEncoder().encode(`data: ${'x'.repeat(65537)}`)]));
    await expect(iterator.next()).rejects.toThrow('SSE_EVENT_TOO_LARGE');
  });
  it('cancels a blocked reader', async () => {
    const controller = new AbortController();
    const iterator = readSse(new ReadableStream(), controller.signal);
    const next = iterator.next();
    controller.abort();
    await expect(next).rejects.toThrow('SSE_CANCELLED');
  });
  it('consumes a real chunked HTTP response without recreating a write', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('id: 1\nevent: turn.started\ndata: {"stage":"probe"}\n\n');
      response.end('id: 2\nevent: turn.completed\ndata: {}\n\n');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      if (!response.body) throw new Error('Missing stream');
      const events = [];
      for await (const event of readSse(response.body)) events.push(event.event);
      expect(events).toEqual(['turn.started', 'turn.completed']);
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
