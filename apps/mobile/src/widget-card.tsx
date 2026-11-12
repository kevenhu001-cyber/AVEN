import { Alert, Linking } from 'react-native';
import type { ConversationWidget } from '@aven/contracts';
import { Action, Card, Copy } from './ui';

type Presentation = { lines: string[]; links?: { label: string; url: string }[] };
function describe(widget: ConversationWidget): Presentation {
  const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
  switch (widget.kind) {
    case 'map_location_card':
      return {
        lines: widget.locations.map((item) => `${item.name} · ${item.formattedAddress}`),
        links: widget.locations.flatMap((item) =>
          item.navigationUrl ? [{ label: item.name, url: item.navigationUrl }] : [],
        ),
      };
    case 'product_comparison_card':
      return {
        lines: widget.items.map(
          (item) => `${item.title} · ${item.shopName} · ${money(item.priceCents)}`,
        ),
        links: widget.items.map((item) => ({ label: item.title, url: item.productUrl })),
      };
    case 'schedule_candidates_card':
      return {
        lines: [
          '未修改外部日历',
          ...widget.clarificationPrompts,
          ...widget.candidates.map((item) => `${item.startAt} – ${item.endAt}`),
        ],
      };
    case 'action_preview_card':
      return {
        lines: [widget.description, '此卡片仅为预览，不会执行外部操作。'],
        ...(widget.targetUrl
          ? { links: [{ label: widget.actionLabel, url: widget.targetUrl }] }
          : {}),
      };
    case 'email_thread_list_card':
      return {
        lines: widget.threads.length
          ? widget.threads.map((item) => `${item.fromLabel} · ${item.subject}\n${item.snippet}`)
          : ['没有邮件摘要。'],
      };
    case 'email_compose_preview_card':
      return {
        lines: [
          `收件人：${widget.to.join('、')}`,
          widget.subject,
          widget.bodyPreview,
          '邮件草稿预览，需要确认；当前不会发送真实邮件。',
        ],
      };
    case 'instant_delivery_card':
      return {
        lines: [
          widget.deliveryAddress,
          ...widget.items.map(
            (item) =>
              `${item.storeName} · ${item.productTitle} · ${money(item.priceCents)} · 约 ${item.etaMinutes} 分钟`,
          ),
        ],
        links: widget.items.map((item) => ({ label: item.productTitle, url: item.orderUrl })),
      };
    case 'local_merchant_card':
      return {
        lines: widget.merchants.map(
          (item) =>
            `${item.name} · ${item.address} · ${item.rating} 分 · 人均 ${money(item.avgPriceCents)}`,
        ),
        links: widget.merchants.map((item) => ({ label: item.name, url: item.merchantUrl })),
      };
    case 'social_connection_card':
      return {
        lines: [
          widget.displayName,
          widget.headline,
          widget.matchReason,
          widget.privacyNotice,
          '这是连接器样例，请在“我的连接”中使用真实连接码发起邀请。',
        ],
      };
    case 'cross_platform_compare_card':
      return {
        lines: widget.items.map(
          (item) =>
            `${item.platformLabel} · ${item.title} · ${money(item.priceCents)} · ${item.fulfillmentHint}`,
        ),
        links: widget.items.map((item) => ({ label: item.title, url: item.targetUrl })),
      };
    case 'weather_travel_card':
      return {
        lines: [
          widget.city,
          `${widget.dateLabel} · ${widget.condition} · ${widget.tempMinC}–${widget.tempMaxC}°C`,
          widget.commuteAdvice,
        ],
      };
    case 'mcp_result_card':
      return {
        lines: [
          widget.summaryText,
          ...widget.rows.map((item) => `${item.label}：${item.value}`),
          widget.externalNotice,
        ],
      };
  }
}
export function NativeWidget({ widget }: { widget: ConversationWidget }) {
  const view = describe(widget);
  function jump(url: string) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return;
    }
    if (target.protocol !== 'https:' || target.username || target.password) return;
    Alert.alert('打开外部网站？', target.href, [
      { text: '取消', style: 'cancel' },
      {
        text: '打开',
        onPress: () => {
          void Linking.openURL(target.href).catch(() => Alert.alert('暂时无法打开链接'));
        },
      },
    ]);
  }
  return (
    <Card>
      <Copy title>{widget.title}</Copy>
      <Copy muted>{widget.providerMode === 'mock' ? 'Mock 样例数据' : '实时数据'}</Copy>
      {view.lines.map((line, index) => (
        <Copy key={index}>{line}</Copy>
      ))}
      {view.links?.map((link, index) => (
        <Action key={index} secondary onPress={() => jump(link.url)}>
          打开 {link.label}（需确认）
        </Action>
      ))}
    </Card>
  );
}
