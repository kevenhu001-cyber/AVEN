'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { PluginActionManifest, PluginManifest } from '@aven/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHead } from '@/components/shell/page';
import { Icon } from './icon';
import { api, errorText, webCall } from './api';
import { connectorServiceFor, connectorServices, useConnectors } from './connectors';
import {
  appsRowAction,
  categoryLabels,
  connectedServiceCount,
  credentialLabel,
  groupCatalog,
  matchesQuery,
} from './halo/catalog';
import { PluginLogo } from './halo/plugin-logo';
import { Mascot } from './mascot';
import { ActionForm, type ConnectorResult } from './plugins/connector-dialog';
import { WidgetCard } from './plugins/widget-card';

function serviceFor(plugin: PluginManifest) {
  return connectorServiceFor(plugin.id);
}

/** Grok-style 连接应用 catalog: flat grouped rows, a right-hand action pill per row and a
 * bottom search bar on mobile. Class names `.apps-item` / `.apps-main` and the h1 are E2E anchors. */
export function AppsCatalog({ pluginId, dialog = false }: { pluginId?: string; dialog?: boolean }) {
  const router = useRouter();
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [action, setAction] = useState<{
    plugin: PluginManifest;
    action: PluginActionManifest;
  } | null>(null);
  const [result, setResult] = useState<ConnectorResult | null>(null);
  const request = useRef<AbortController | null>(null);
  const connectors = useConnectors();

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus('loading');
    try {
      const data = await api.plugins.listCatalog(webCall(controller.signal));
      if (controller.signal.aborted) return;
      setPlugins(data.plugins);
      setStatus('ready');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(errorText(cause));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    return () => request.current?.abort();
  }, [load]);

  const selected = pluginId ? plugins.find((plugin) => plugin.id === pluginId) : undefined;
  const connectorStatus = useCallback(
    (plugin: PluginManifest) => {
      const service = serviceFor(plugin);
      return service ? connectors.statusFor(service) : undefined;
    },
    [connectors],
  );

  const connectedCount = useMemo(
    () =>
      connectedServiceCount(
        Object.keys(connectorServices).map((service) => connectors.statusFor(service)),
      ),
    [connectors],
  );
  const sections = useMemo(() => {
    if (!dialog) return groupCatalog(plugins, query, false);
    const filtered = plugins.filter(
      (plugin) => matchesQuery(plugin, query) && (category === 'all' || plugin.category === category),
    );
    if (query.trim())
      return filtered.length ? [{ id: 'search', title: '搜索结果', plugins: filtered }] : [];
    if (category !== 'all')
      return filtered.length
        ? [
            {
              id: category,
              title: categoryLabels[category] ?? category,
              plugins: filtered,
            },
          ]
        : [];
    return groupCatalog(filtered, '', true);
  }, [category, dialog, plugins, query]);

  const dialogCategories = useMemo(
    () => [...new Set(plugins.map((plugin) => plugin.category))],
    [plugins],
  );
  const connectedPlugins = useMemo(() => {
    const seen = new Set<string>();
    return plugins.filter((plugin) => {
      const service = serviceFor(plugin);
      if (!service || connectors.statusFor(service) !== 'connected' || seen.has(service)) return false;
      seen.add(service);
      return true;
    });
  }, [connectors, plugins]);
  const visibleDialogCategories =
    showMoreCategories || dialogCategories.length <= 5
      ? dialogCategories
      : dialogCategories.slice(0, 5);

  if (pluginId) {
    return (
      <div className="page">
        <PageHead
          title="连接应用"
          description={selected?.description ?? '正在读取应用信息…'}
          actions={
            <Link className="shell-link-button" href="/apps">
              返回应用列表
            </Link>
          }
        />
        {status === 'loading' && <p className="muted">正在读取应用信息…</p>}
        {status === 'error' && (
          <Alert variant="warning">
            {error}{' '}
            <button type="button" className="halo-text-button" onClick={() => void load()}>
              重试
            </button>
          </Alert>
        )}
        {status === 'ready' && !selected && (
          <Alert variant="warning">没有找到该应用。它可能尚未接入或已下线。</Alert>
        )}
        {selected && (
          <PluginDetail
            plugin={selected}
            connectorStatus={connectorStatus(selected)}
            action={action}
            result={result}
            onAction={(next) => setAction(next)}
            onCloseAction={() => setAction(null)}
            onResult={(next) => {
              setAction(null);
              setResult(next);
            }}
            onExpired={() => router.refresh()}
          />
        )}
      </div>
    );
  }

  const search = (
    <label className="halo-search apps-search">
      <Icon name="search" size={17} />
      <span className="sr-only">搜索应用和技能</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索应用和技能"
      />
    </label>
  );

  return (
    <div className={dialog ? 'apps-page apps-page-dialog' : 'page apps-page'}>
      {dialog ? (
        <header className="apps-dialog-head">
          <div className="apps-dialog-topline">
            <DialogPrimitive.Title asChild>
              <h1>连接应用</h1>
            </DialogPrimitive.Title>
            <Link className="apps-connected-link" href="/connectors">
              <span className="apps-connected-icons" aria-hidden="true">
                {connectedPlugins.slice(0, 4).map((plugin) => (
                  <PluginLogo key={plugin.id} id={plugin.id} category={plugin.category} />
                ))}
              </span>
              <span>已连接 {connectedCount} 个</span>
              <Icon name="chevron" size={20} />
            </Link>
            <DialogPrimitive.Close
              className="halo-round halo-round-ghost"
              aria-label="关闭连接应用"
            >
              <Icon name="x" size={20} />
            </DialogPrimitive.Close>
          </div>
          <div className="apps-dialog-search-row">
            {search}
            <button
              type="button"
              className="apps-template-link"
              disabled
              title="Bot 模板尚未开放"
            >
              <Mascot size={24} state="idle" />
              <span>Bot 模板</span>
              <Icon name="chevron" size={17} />
            </button>
          </div>
          <div className="apps-category-list" role="tablist" aria-label="应用类别">
            <button
              type="button"
              role="tab"
              aria-selected={category === 'all'}
              className="apps-category-chip"
              data-active={category === 'all'}
              onClick={() => setCategory('all')}
            >
              全部
            </button>
            {visibleDialogCategories.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={category === value}
                className="apps-category-chip"
                data-active={category === value}
                onClick={() => setCategory(value)}
              >
                {categoryLabels[value] ?? value}
              </button>
            ))}
            {dialogCategories.length > 5 && (
              <button
                type="button"
                className="apps-category-chip apps-category-more"
                aria-expanded={showMoreCategories}
                onClick={() => setShowMoreCategories((value) => !value)}
              >
                {showMoreCategories ? '收起' : '更多'}
                <Icon name="down" size={15} />
              </button>
            )}
          </div>
        </header>
      ) : (
        <PageHead
          title="连接应用"
          description="按需调用服务端连接器。只有已配置真实凭据的应用可以执行动作；授权由 Open Connector 网关完成。"
          actions={
            <span className="halo-pill halo-pill-neutral apps-count">
              已连接 {connectedCount} 个
            </span>
          }
        />
      )}
      <div className="apps-body">
        {status === 'error' && (
          <Alert variant="warning">
            {error}{' '}
            <button type="button" className="halo-text-button" onClick={() => void load()}>
              刷新目录
            </button>
          </Alert>
        )}
        {status === 'loading' && !plugins.length && (
          <div className="apps-loading" role="status">
            <span className="halo-skeleton" />
            <span className="halo-skeleton" />
            <span className="halo-skeleton" />
            <span className="sr-only">正在读取连接器目录…</span>
          </div>
        )}
        {status === 'ready' && !sections.length && (
          <div className="page-empty">
            <h2>没有匹配的应用</h2>
            <p>换个关键词，或清空搜索查看全部应用。</p>
            <button type="button" className="shell-link-button" onClick={() => setQuery('')}>
              清空搜索
            </button>
          </div>
        )}
        {sections.map((section) => (
          <section key={section.id} className="apps-section" id={`apps-section-${section.id}`}>
            <h2 className="apps-heading">
              <span>
                {dialog && section.id === 'featured' ? '为你推荐' : section.title}
              </span>
              {dialog && (
                <Link className="apps-view-all" href="/apps">
                  查看全部
                </Link>
              )}
            </h2>
            <ul className="apps-list">
              {section.plugins.map((plugin) => {
                const service = serviceFor(plugin);
                const connected = connectorStatus(plugin) === 'connected';
                const canRun = plugin.credentialStatus === 'configured';
                const rowAction = appsRowAction(Boolean(service), connected);
                const expanded = open === plugin.id;
                return (
                  <li key={plugin.id} className="apps-item" data-expanded={expanded}>
                    <div className="apps-row">
                      <button
                        type="button"
                        className="apps-main halo-press-soft"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : plugin.id)}
                      >
                        <PluginLogo id={plugin.id} category={plugin.category} />
                        <span className="apps-text">
                          <span className="apps-name">
                            {plugin.name}
                            {!dialog && (
                              <span className="apps-category">
                                {categoryLabels[plugin.category] ?? plugin.category}
                              </span>
                            )}
                          </span>
                          <span className="apps-desc">{plugin.description}</span>
                          {!dialog && (
                            <span className="apps-meta">
                              <span>{credentialLabel(plugin.credentialStatus)}</span>
                              {service && <span>{connected ? '网关已连接' : '网关未连接'}</span>}
                            </span>
                          )}
                        </span>
                      </button>
                      {rowAction.disabled ? (
                        <button
                          type="button"
                          className="halo-pill halo-pill-neutral"
                          disabled
                          aria-label={`${plugin.name} 尚未接入`}
                        >
                          {rowAction.label}
                        </button>
                      ) : (
                        <Link
                          className={`halo-pill halo-pill-${rowAction.tone} halo-press`}
                          href="/connectors"
                          aria-label={`${rowAction.label} ${plugin.name}`}
                        >
                          {connected && <Icon name="check" size={14} />}
                          {rowAction.label}
                        </Link>
                      )}
                    </div>
                    {expanded && (
                      <div className="apps-expand">
                        <div className="apps-expand-meta">
                          <span>{credentialLabel(plugin.credentialStatus)}</span>
                          <span>{plugin.readOnly ? '只读' : '可写入'}</span>
                          {service && <span>{connected ? '网关已连接' : '网关未连接'}</span>}
                        </div>
                        <div className="apps-actions">
                          {plugin.actions.map((item) => (
                            <button
                              key={item.name}
                              type="button"
                              className="halo-chip"
                              disabled={!canRun}
                              onClick={() => setAction({ plugin, action: item })}
                            >
                              {item.title}
                            </button>
                          ))}
                          {!canRun && (
                            <span className="apps-note">未配置真实凭据，动作暂不可用。</span>
                          )}
                        </div>
                        {action && action.plugin.id === plugin.id && (
                          <ActionForm
                            key={`${action.plugin.id}:${action.action.name}`}
                            plugin={action.plugin}
                            action={action.action}
                            onClose={() => setAction(null)}
                            onResult={(next) => {
                              setAction(null);
                              setResult(next);
                            }}
                            onExpired={() => router.refresh()}
                          />
                        )}
                        {result && result.pluginId === plugin.id && <ResultCard result={result} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {!dialog && <div className="apps-searchbar">{search}</div>}
    </div>
  );
}

function PluginDetail({
  plugin,
  connectorStatus,
  action,
  result,
  onAction,
  onCloseAction,
  onResult,
  onExpired,
}: {
  plugin: PluginManifest;
  connectorStatus: string | undefined;
  action: { plugin: PluginManifest; action: PluginActionManifest } | null;
  result: ConnectorResult | null;
  onAction: (next: { plugin: PluginManifest; action: PluginActionManifest }) => void;
  onCloseAction: () => void;
  onResult: (result: ConnectorResult) => void;
  onExpired: () => void;
}) {
  const service = serviceFor(plugin);
  const canRun = plugin.credentialStatus === 'configured';
  return (
    <section className="apps-detail">
      <div className="apps-detail-head">
        <PluginLogo id={plugin.id} category={plugin.category} size="lg" />
        <div>
          <h2>{plugin.name}</h2>
          <p>{plugin.description}</p>
          <div className="apps-meta">
            <Badge variant={canRun ? 'success' : 'warning'}>
              {canRun ? '已配置真实凭据' : credentialLabel(plugin.credentialStatus)}
            </Badge>
            <Badge variant="outline">{plugin.readOnly ? '只读' : '可写入'}</Badge>
            {service && (
              <Badge variant={connectorStatus === 'connected' ? 'success' : 'outline'}>
                {connectorStatus === 'connected' ? '网关已连接' : '网关未连接'}
              </Badge>
            )}
          </div>
        </div>
      </div>
      {service && (
        <div className="apps-actions">
          <Link className="shell-link-button" href="/connectors">
            {connectorStatus === 'connected' ? '管理账号授权' : '前往账号授权'}
          </Link>
        </div>
      )}
      <h3>可用动作</h3>
      {!canRun && (
        <Alert variant="warning">
          该服务尚未配置真实凭据，动作暂不可用。请先完成账号授权或由管理员配置服务凭据。
        </Alert>
      )}
      <div className="apps-actions">
        {plugin.actions.map((item) => (
          <button
            key={item.name}
            type="button"
            className="halo-chip"
            disabled={!canRun}
            onClick={() => onAction({ plugin, action: item })}
          >
            {item.title}
          </button>
        ))}
      </div>
      {action && action.plugin.id === plugin.id && (
        <ActionForm
          key={`${action.plugin.id}:${action.action.name}`}
          plugin={action.plugin}
          action={action.action}
          onClose={onCloseAction}
          onResult={onResult}
          onExpired={onExpired}
        />
      )}
      {result && result.pluginId === plugin.id && <ResultCard result={result} />}
    </section>
  );
}

function ResultCard({ result }: { result: ConnectorResult }) {
  return (
    <article className="apps-result">
      <div className="widget-turn-head">
        <span>
          {result.pluginName} · {result.actionTitle}
        </span>
        <Badge variant={result.providerMode === 'live' ? 'success' : 'secondary'}>
          {result.providerMode === 'live' ? '实时数据' : '已连接数据'}
        </Badge>
      </div>
      <p>{result.summary}</p>
      {result.widgets.map((widget) => (
        <WidgetCard key={widget.widgetId} widget={widget} />
      ))}
    </article>
  );
}
