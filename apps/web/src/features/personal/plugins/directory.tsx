'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PluginManifest } from '@aven/contracts';
import { api, errorText, webCall } from '../api';
import { PluginLogo } from '../halo/plugin-logo';
import { categoryLabels, matchesQuery } from '../halo/catalog';
import { ActionForm, type ConnectorResult } from './connector-dialog';
import { WidgetCard } from './widget-card';
import { upcomingPlugins } from './directory-data';
import './directory.css';

export function PluginDirectory({ pluginId }: { pluginId?: string }) {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [action, setAction] = useState('');
  const [result, setResult] = useState<ConnectorResult | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus('loading');
    setPlugins([]);
    setResult(null);
    setAction('');
    try {
      const data = await api.plugins.listCatalog(webCall(controller.signal));
      if (!controller.signal.aborted) {
        setPlugins(data.plugins);
        setStatus('ready');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorText(cause));
        setStatus('error');
      }
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    const hide = () => {
      request.current?.abort();
      setPlugins([]);
      setResult(null);
      setAction('');
      setStatus('loading');
    };
    const visible = () => {
      if (document.hidden) hide();
      else void load();
    };
    const online = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', hide);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted = false;
      request.current?.abort();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', hide);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  const selected = plugins.find((p) => p.id === pluginId);
  const preview = upcomingPlugins.find((p) => p.id === pluginId);
  const title = selected?.name ?? preview?.name ?? '插件详情';
  const activeAction = selected?.actions.find((item) => item.name === action);
  const catalog = plugins.filter(
    (p) => (category === 'all' || p.category === category) && matchesQuery(p, query),
  );
  const upcoming = upcomingPlugins.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      `${p.name} ${p.description} ${categoryLabels[p.category]}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <main className="plugin-directory">
      <header className="plugin-nav">
        <Link href="/">AVEN</Link>
        <nav aria-label="插件导航">
          <Link href="/plugins">插件目录</Link>
          <Link href="/connectors">账号连接</Link>
        </nav>
      </header>
      {pluginId ? (
        <>
          <Link className="plugin-back" href="/plugins">
            ← 返回目录
          </Link>
          {status === 'ready' && (selected || preview) && (
            <section className="plugin-detail">
              <PluginLogo
                id={pluginId}
                category={selected?.category ?? preview?.category ?? 'productivity'}
                size="lg"
              />
              <h1>{title}</h1>
              <p>{selected?.description ?? preview?.description}</p>
              <span className="plugin-state">{selected ? 'Mock 可用' : '即将开放'}</span>
              <p className="plugin-note">
                {selected
                  ? '以下动作仅使用模拟数据，提交前请检查参数。真实账号授权可在账号连接页管理。'
                  : '图标与服务介绍已准备好，服务尚未接入，当前不会发起授权或执行动作。'}
              </p>
              {selected && (
                <>
                  <h2>可用动作</h2>
                  <div className="plugin-actions">
                    {selected.actions.map((item) => (
                      <button
                        key={item.name}
                        aria-pressed={action === item.name}
                        onClick={() => {
                          setAction(item.name);
                          setResult(null);
                        }}
                      >
                        {item.title}
                      </button>
                    ))}
                  </div>
                  {activeAction && (
                    <ActionForm
                      key={`${selected.id}:${activeAction.name}`}
                      plugin={selected}
                      action={activeAction}
                      onClose={() => setAction('')}
                      onExpired={() => void load()}
                      onResult={(value) => {
                        setResult(value);
                        setAction('');
                      }}
                    />
                  )}
                  <h2>权限与数据</h2>
                  <p>
                    {selected.readOnly ? '只读动作' : '包含写入类动作，请逐次检查确认范围'} ·{' '}
                    {selected.providerName}
                  </p>
                  <p className="plugin-note">
                    模拟调用不会访问你的第三方账号。连接账号不代表同意向他人分享信息。
                  </p>
                  {result && (
                    <section aria-label="调用结果" className="plugin-result">
                      <h2>{result.actionTitle}</h2>
                      <p>{result.summary}</p>
                      {result.widgets.map((widget) => (
                        <WidgetCard key={widget.widgetId} widget={widget} />
                      ))}
                    </section>
                  )}
                </>
              )}
            </section>
          )}
          {status === 'ready' && !selected && !preview && (
            <section className="plugin-empty">
              <h1>没有找到这个插件</h1>
              <p>插件可能已下架或当前无权查看。</p>
              <Link href="/plugins">浏览全部插件</Link>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="plugin-intro">
            <p className="plugin-kicker">工具，随需要而来</p>
            <h1>给对话更多能力</h1>
            <p>从整理信息到安排日程，选择适合此刻的插件。</p>
          </section>
          <div className="plugin-toolbar">
            <label className="plugin-search">
              <span>搜索插件</span>
              <input
                type="search"
                placeholder="搜索名称、用途或动作"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              可用状态
              <select value={availability} onChange={(e) => setAvailability(e.target.value)}>
                <option value="all">全部状态</option>
                <option value="mock">Mock 可用</option>
                <option value="upcoming">即将开放</option>
              </select>
            </label>
          </div>
          <nav className="plugin-categories" aria-label="插件分类">
            {[['all', '全部'], ...Object.entries(categoryLabels)].map(([key, label]) => (
              <button key={key} aria-pressed={category === key} onClick={() => setCategory(key!)}>
                {label}
              </button>
            ))}
          </nav>
          {status === 'ready' && (
            <>
              <div className="plugin-list-heading">
                <h2>{query ? '搜索结果' : '探索插件'}</h2>
                <span>
                  {(availability === 'upcoming' ? 0 : catalog.length) +
                    (availability === 'mock' ? 0 : upcoming.length)}{' '}
                  项
                </span>
              </div>
              <div className="plugin-grid">
                {availability !== 'upcoming' &&
                  catalog.map((plugin) => (
                    <PluginTile key={plugin.id} {...plugin} state="Mock 可用" />
                  ))}
                {availability !== 'mock' &&
                  upcoming.map((plugin) => (
                    <PluginTile key={plugin.id} {...plugin} state="即将开放" />
                  ))}
              </div>
              {(availability === 'upcoming' || !catalog.length) &&
                (availability === 'mock' || !upcoming.length) && (
                  <div className="plugin-empty">
                    <h2>没有匹配的插件</h2>
                    <p>试试其他关键词或分类。</p>
                    <button
                      onClick={() => {
                        setQuery('');
                        setCategory('all');
                        setAvailability('all');
                      }}
                    >
                      清除筛选
                    </button>
                  </div>
                )}
              <aside className="plugin-footnote">
                真实第三方账号通过 Open Connector 授权。当前目录中的可调用动作均为
                Mock；尚未接入的服务仅作介绍。
              </aside>
            </>
          )}
        </>
      )}
      {status === 'loading' && (
        <p role="status" className="plugin-empty">
          正在读取插件目录…
        </p>
      )}
      {status === 'error' && (
        <section className="plugin-empty" role="alert">
          <h2>暂时无法读取目录</h2>
          <p>{error}</p>
          <button onClick={() => void load()}>重新读取</button>
          <Link href="/">返回首页登录</Link>
        </section>
      )}
    </main>
  );
}
function PluginTile({
  id,
  name,
  description,
  category,
  state,
}: {
  id: string;
  name: string;
  description: string;
  category: string;
  state: string;
}) {
  return (
    <Link href={`/plugins/${encodeURIComponent(id)}`} className="plugin-tile">
      <div className="plugin-tile-top">
        <PluginLogo id={id} category={category} size="lg" />
        <span className="plugin-state">{state}</span>
      </div>
      <h3>{name}</h3>
      <p>{description}</p>
      <span className="plugin-tile-footer">
        {categoryLabels[category] ?? '其他'}
        <span aria-hidden="true">↗</span>
      </span>
    </Link>
  );
}
