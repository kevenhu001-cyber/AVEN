'use client';

import { useState } from 'react';
import type { ConversationWidget } from '@aven/contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function cents(value: number) {
  return `¥${(value / 100).toFixed(2)}`;
}

function modeBadge(providerMode: string) {
  if (providerMode === 'live') return <Badge variant="success">实时数据</Badge>;
  return <Badge variant="warning">Mock 数据</Badge>;
}

function ExternalLink({ url, label }: { url?: string | undefined; label: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!url) return null;
  if (!confirming) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 self-start">
      <a className="small" href={url} target="_blank" rel="noreferrer noopener">
        {url}
      </a>
      <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
        取消
      </Button>
    </span>
  );
}

export function WidgetCard({ widget }: { widget: ConversationWidget }) {
  return (
    <Card className="widget-card" data-widget-kind={widget.kind}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle>{widget.title}</CardTitle>
        {modeBadge(widget.providerMode)}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{renderBody(widget)}</CardContent>
    </Card>
  );
}

function renderBody(widget: ConversationWidget) {
  switch (widget.kind) {
    case 'map_location_card':
      return (
        <>
          <p className="small muted m-0">
            检索「{widget.query}」{widget.city ? ` · ${widget.city}` : ''} · 来源：
            {widget.sourceAttribution}
          </p>
          <ul className="widget-list">
            {widget.locations.map((item) => (
              <li key={item.poiId}>
                <strong>{item.name}</strong>
                <span className="muted"> {item.formattedAddress}</span>
                {item.distanceMeters !== undefined && (
                  <span className="muted"> · {Math.round(item.distanceMeters)} 米</span>
                )}
              </li>
            ))}
          </ul>
          {widget.locations[0]?.navigationUrl && (
            <ExternalLink
              url={widget.locations[0].navigationUrl}
              label="打开导航链接（需你确认）"
            />
          )}
        </>
      );
    case 'product_comparison_card':
      return (
        <>
          <p className="small muted m-0">
            「{widget.query}」· {widget.platformLabel} · 跳转到外部商品页前需要你确认
          </p>
          <ul className="widget-list">
            {widget.items.map((item) => (
              <li key={item.itemId}>
                <strong>{item.title}</strong>
                <span className="muted"> · {item.shopName}</span>
                <span> · {cents(item.priceCents)}</span>
                {item.rating !== undefined && <span className="muted"> · 评分 {item.rating}</span>}
                {item.tags.length > 0 && <span className="muted"> · {item.tags.join('/')}</span>}
                <ExternalLink url={item.productUrl} label="打开商品页（需你确认）" />
              </li>
            ))}
          </ul>
        </>
      );
    case 'schedule_candidates_card':
      return (
        <>
          <p className="small muted m-0">
            状态：{widget.status} · 时区：{widget.timezone} · 未修改任何外部日历
          </p>
          {widget.clarificationPrompts.length > 0 && (
            <ul className="widget-list">
              {widget.clarificationPrompts.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ul>
          )}
          <ul className="widget-list">
            {widget.candidates.map((slot) => (
              <li key={`${slot.startAt}-${slot.endAt}`}>
                {new Date(slot.startAt).toLocaleString('zh-CN')} –{' '}
                {new Date(slot.endAt).toLocaleTimeString('zh-CN')}
                <span className="muted"> · {slot.reason}</span>
              </li>
            ))}
          </ul>
        </>
      );
    case 'action_preview_card':
      return (
        <>
          <p className="m-0">{widget.description}</p>
          <p className="small muted m-0">动作：{widget.actionLabel} · 执行前需要你确认</p>
          <ExternalLink url={widget.targetUrl} label="打开目标链接（需你确认）" />
        </>
      );
    case 'email_thread_list_card':
      return (
        <>
          <p className="small muted m-0">
            邮箱：{widget.mailboxProvider} · 检索「{widget.query}」
          </p>
          {widget.threads.length === 0 ? (
            <p className="muted m-0">没有匹配的邮件摘要。</p>
          ) : (
            <ul className="widget-list">
              {widget.threads.map((thread) => (
                <li key={thread.threadId}>
                  <strong>{thread.subject}</strong>
                  <span className="muted"> · {thread.fromLabel}</span>
                  {thread.unread && <Badge variant="accent">未读</Badge>}
                  <span className="muted"> {thread.snippet}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case 'email_compose_preview_card':
      return (
        <>
          <p className="small muted m-0">
            收件人：{widget.to.join('、')}
            {widget.cc.length > 0 ? ` · 抄送：${widget.cc.join('、')}` : ''}
          </p>
          <p className="m-0">主题：{widget.subject}</p>
          <p className="small muted m-0 whitespace-pre-wrap">{widget.bodyPreview}</p>
          <p className="small muted m-0">
            状态：{widget.status === 'sent' ? '已发送' : '草稿预览'}
            {widget.requiresUserConfirmation ? ' · 发送需要你确认' : ''}
          </p>
        </>
      );
    case 'instant_delivery_card':
      return (
        <>
          <p className="small muted m-0">
            「{widget.query}」· 送至 {widget.deliveryAddress} · 下单前需要你确认
          </p>
          <ul className="widget-list">
            {widget.items.map((item) => (
              <li key={item.itemId}>
                <strong>{item.productTitle}</strong>
                <span className="muted"> · {item.storeName}</span>
                <span> · {cents(item.priceCents)}</span>
                <span className="muted"> · 配送 {cents(item.deliveryFeeCents)}</span>
                <span className="muted"> · 约 {item.etaMinutes} 分钟</span>
                <ExternalLink url={item.orderUrl} label="打开下单链接（需你确认）" />
              </li>
            ))}
          </ul>
        </>
      );
    case 'local_merchant_card':
      return (
        <>
          <p className="small muted m-0">
            「{widget.query}」{widget.city ? ` · ${widget.city}` : ''} · 跳转到外部页面前需要你确认
          </p>
          <ul className="widget-list">
            {widget.merchants.map((item) => (
              <li key={item.merchantId}>
                <strong>{item.name}</strong>
                <span className="muted"> · {item.category}</span>
                <span className="muted"> · 评分 {item.rating}</span>
                <span> · 人均 {cents(item.avgPriceCents)}</span>
                <span className="muted"> · {item.openStatus}</span>
                <ExternalLink url={item.merchantUrl} label="打开商户页（需你确认）" />
              </li>
            ))}
          </ul>
        </>
      );
    case 'social_connection_card':
      return (
        <>
          <p className="m-0">
            <strong>{widget.displayName}</strong>
            <span className="muted"> · {widget.headline}</span>
          </p>
          <p className="small muted m-0">
            匹配理由：{widget.matchReason} · 状态：{widget.status} · 用途：{widget.purpose} ·{' '}
            {widget.expiresInDays} 天后过期
          </p>
          <p className="small muted m-0">共享字段：{widget.selectedFields.join('、')}</p>
          <p className="small muted m-0">{widget.privacyNotice}</p>
        </>
      );
    case 'cross_platform_compare_card':
      return (
        <>
          <p className="small muted m-0">
            「{widget.query}」· 最低价：{widget.bestPricePlatformLabel} · 最快送达：
            {widget.fastestDeliveryPlatformLabel}
          </p>
          <ul className="widget-list">
            {widget.items.map((item) => (
              <li key={`${item.platform}-${item.itemId}`}>
                <Badge variant="outline">{item.platformLabel}</Badge>
                <strong> {item.title}</strong>
                <span className="muted"> · {item.shopOrStoreName}</span>
                <span> · {cents(item.priceCents)}</span>
                <span className="muted"> · {item.fulfillmentHint}</span>
                <ExternalLink url={item.targetUrl} label="打开链接（需你确认）" />
              </li>
            ))}
          </ul>
        </>
      );
    case 'weather_travel_card':
      return (
        <>
          <p className="m-0">
            {widget.city} · {widget.dateLabel} · {widget.condition} · {widget.tempMinC}° ~{' '}
            {widget.tempMaxC}°
          </p>
          <p className="small muted m-0">出行建议：{widget.commuteAdvice}</p>
        </>
      );
    case 'mcp_result_card': {
      const rows = widget.rows ?? [];
      return (
        <>
          <p className="small muted m-0">
            服务器：{widget.serverName} · 工具：{widget.toolName} · {widget.externalNotice}
          </p>
          <p className="m-0">{widget.summaryText}</p>
          {rows.length > 0 && (
            <ul className="widget-list">
              {rows.map((row) => (
                <li key={row.label}>
                  <strong>{row.label}</strong>
                  <span className="muted"> · {row.value}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    }
    default:
      return <p className="muted m-0">该小组件类型暂未渲染。</p>;
  }
}
