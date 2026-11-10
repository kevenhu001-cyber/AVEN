'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiClientError, createApiClient } from '@aven/api-client';

type State =
  | { kind: 'idle' | 'loading' | 'cancelled' }
  | { kind: 'success'; requestId: string }
  | { kind: 'error'; code: string };
const client = createApiClient();

function errorCode(error: unknown): string {
  return error instanceof ApiClientError ? (error.apiCode ?? error.code) : 'NETWORK_ERROR';
}

export function HealthCheck() {
  const [live, setLive] = useState<State>({ kind: 'idle' });
  const [ready, setReady] = useState<State>({ kind: 'idle' });
  const liveActive = useRef<AbortController | null>(null);
  const readyActive = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      liveActive.current?.abort();
      readyActive.current?.abort();
    },
    [],
  );

  async function checkLive() {
    liveActive.current?.abort();
    const controller = new AbortController();
    liveActive.current = controller;
    setLive({ kind: 'loading' });
    try {
      const result = await client.getLiveness(controller.signal);
      if (liveActive.current === controller)
        setLive({ kind: 'success', requestId: result.request_id });
    } catch (error) {
      if (liveActive.current === controller && !controller.signal.aborted)
        setLive({ kind: 'error', code: errorCode(error) });
    } finally {
      if (liveActive.current === controller) liveActive.current = null;
    }
  }

  async function checkReady() {
    readyActive.current?.abort();
    const controller = new AbortController();
    readyActive.current = controller;
    setReady({ kind: 'loading' });
    try {
      const result = await client.getReadiness(controller.signal);
      if (readyActive.current === controller)
        setReady({ kind: 'success', requestId: result.request_id });
    } catch (error) {
      if (readyActive.current === controller && !controller.signal.aborted)
        setReady({ kind: 'error', code: errorCode(error) });
    } finally {
      if (readyActive.current === controller) readyActive.current = null;
    }
  }

  function cancelLive() {
    liveActive.current?.abort();
    liveActive.current = null;
    setLive({ kind: 'cancelled' });
  }

  function cancelReady() {
    readyActive.current?.abort();
    readyActive.current = null;
    setReady({ kind: 'cancelled' });
  }

  return (
    <>
      <section
        className="connection"
        aria-labelledby="connection-title"
        aria-busy={live.kind === 'loading'}
      >
        <div>
          <p className="eyebrow">真实 HTTP 请求</p>
          <h2 id="connection-title">检查 API 连接</h2>
          <p>通过 Web 同源代理读取存活探针，不发送私人资料。</p>
        </div>
        <div className="actions">
          <button onClick={() => void checkLive()} disabled={live.kind === 'loading'}>
            {live.kind === 'loading'
              ? '正在检查…'
              : live.kind === 'error'
                ? '重试连接'
                : '检查连接'}
          </button>
          {live.kind === 'loading' && (
            <button className="secondary" onClick={cancelLive}>
              取消检查
            </button>
          )}
        </div>
        <div className="feedback" role="status" aria-live="polite">
          {live.kind === 'idle' && <p>尚未检查。请先在另一个终端启动 API。</p>}
          {live.kind === 'loading' && <p>正在请求 API 存活探针…</p>}
          {live.kind === 'cancelled' && <p>已取消本次检查。</p>}
          {live.kind === 'success' && (
            <>
              <p className="success">API 进程可访问</p>
              <p>仅证明存活，不代表数据库或业务已就绪。</p>
              <code>Request ID: {live.requestId}</code>
            </>
          )}
          {live.kind === 'error' && (
            <>
              <p className="failure">暂时无法确认 API 连接</p>
              <p>请检查 API 进程及本地代理配置后重试。错误类型：{live.code}</p>
            </>
          )}
        </div>
      </section>

      <section
        className="connection"
        aria-labelledby="readiness-title"
        aria-busy={ready.kind === 'loading'}
      >
        <div>
          <p className="eyebrow">依赖就绪检查</p>
          <h2 id="readiness-title">检查数据库与 Redis</h2>
          <p>读取就绪探针；依赖不可用或迁移未应用时不会显示为成功。</p>
        </div>
        <div className="actions">
          <button onClick={() => void checkReady()} disabled={ready.kind === 'loading'}>
            {ready.kind === 'loading'
              ? '正在检查…'
              : ready.kind === 'error'
                ? '重试依赖检查'
                : '检查依赖'}
          </button>
          {ready.kind === 'loading' && (
            <button className="secondary" onClick={cancelReady}>
              取消检查
            </button>
          )}
        </div>
        <div className="feedback" role="status" aria-live="polite">
          {ready.kind === 'idle' && <p>尚未检查。依赖就绪不代表业务功能已完成。</p>}
          {ready.kind === 'loading' && <p>正在请求 API 就绪探针…</p>}
          {ready.kind === 'cancelled' && <p>已取消本次检查。</p>}
          {ready.kind === 'success' && (
            <>
              <p className="success">依赖已就绪</p>
              <p>数据库、Redis 与迁移版本均已确认；业务接口仍未开放。</p>
              <code>Request ID: {ready.requestId}</code>
            </>
          )}
          {ready.kind === 'error' && (
            <>
              <p className="failure">依赖尚未就绪</p>
              <p>请启动本地 PostgreSQL/Redis 并执行迁移后重试。错误类型：{ready.code}</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
