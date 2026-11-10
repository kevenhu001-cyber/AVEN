'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiClientError, createApiClient } from '@aven/api-client';

type State =
  | { kind: 'idle' | 'loading' | 'cancelled' }
  | { kind: 'success'; requestId: string }
  | { kind: 'error'; code: string };
const client = createApiClient();

export function HealthCheck() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  async function check() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ kind: 'loading' });
    try {
      const result = await client.getLiveness(controller.signal);
      if (active.current === controller)
        setState({ kind: 'success', requestId: result.request_id });
    } catch (error) {
      if (active.current === controller && !controller.signal.aborted)
        setState({
          kind: 'error',
          code: error instanceof ApiClientError ? error.code : 'NETWORK_ERROR',
        });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }
  function cancel() {
    active.current?.abort();
    active.current = null;
    setState({ kind: 'cancelled' });
  }
  return (
    <section
      className="connection"
      aria-labelledby="connection-title"
      aria-busy={state.kind === 'loading'}
    >
      <div>
        <p className="eyebrow">真实 HTTP 请求</p>
        <h2 id="connection-title">检查 API 连接</h2>
        <p>通过 Web 同源代理读取存活探针，不发送私人资料。</p>
      </div>
      <div className="actions">
        <button onClick={() => void check()} disabled={state.kind === 'loading'}>
          {state.kind === 'loading'
            ? '正在检查…'
            : state.kind === 'error'
              ? '重试连接'
              : '检查连接'}
        </button>
        {state.kind === 'loading' && (
          <button className="secondary" onClick={cancel}>
            取消检查
          </button>
        )}
      </div>
      <div className="feedback" role="status" aria-live="polite">
        {state.kind === 'idle' && <p>尚未检查。请先在另一个终端启动 API。</p>}
        {state.kind === 'loading' && <p>正在请求 API 存活探针…</p>}
        {state.kind === 'cancelled' && <p>已取消本次检查。</p>}
        {state.kind === 'success' && (
          <>
            <p className="success">API 进程可访问</p>
            <p>仅证明存活，不代表数据库或业务已就绪。</p>
            <code>Request ID: {state.requestId}</code>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <p className="failure">暂时无法确认 API 连接</p>
            <p>请检查 API 进程及本地代理配置后重试。错误类型：{state.code}</p>
          </>
        )}
      </div>
    </section>
  );
}
