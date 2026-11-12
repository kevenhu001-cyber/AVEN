import { z } from 'zod';
import {
  CrossPlatformOfferItemSchema,
  TOOL_PERMISSIONS,
  type CrossPlatformCompareWidget,
  type CrossPlatformOfferItem,
} from '@aven/contracts';
import type { PluginActionHandler, PluginConnector, PluginRegistry } from './registry.js';

export const CrossCompareInputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    maxPriceYuan: z.number().min(1).max(1_000_000).optional(),
    deliveryAddress: z.string().trim().min(1).max(160).default('北京市海淀区'),
    limitPerPlatform: z.number().int().min(1).max(5).default(2),
  })
  .strict();

export const CrossCompareOutputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    total: z.number().int().min(0).max(50),
    bestPricePlatformLabel: z.string().trim().min(1).max(80),
    fastestDeliveryPlatformLabel: z.string().trim().min(1).max(80),
    items: z.array(CrossPlatformOfferItemSchema).max(15),
  })
  .strict();

export function createCrossPlatformComparePlugin(
  getRegistry: () => PluginRegistry,
): PluginConnector {
  const action: PluginActionHandler<
    z.infer<typeof CrossCompareInputSchema>,
    z.infer<typeof CrossCompareOutputSchema>
  > = {
    name: 'compare_products',
    title: '跨平台智能比价汇总',
    description: '聚合淘宝、京东与淘宝闪购搜索结果，在同一小组件内横向对比价格与配送时效。',
    inputSchema: CrossCompareInputSchema,
    outputSchema: CrossCompareOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeCommerce],
    widgetKinds: ['cross_platform_compare_card'],
    timeoutMs: 10_000,
    maxRetries: 0,
    idempotent: true,
    execute: async (input, context) => {
      const registry = getRegistry();
      const collected: CrossPlatformOfferItem[] = [];

      const commerceTargets: Array<{ pluginId: string; platformLabel: string; hint: string }> = [
        { pluginId: 'jd.commerce', platformLabel: '京东商城', hint: '次日达 / 快递配送' },
        { pluginId: 'taobao.commerce', platformLabel: '淘宝 / 天猫', hint: '48小时内发货' },
      ];

      for (const target of commerceTargets) {
        if (!registry.has(target.pluginId)) continue;
        const result = await registry.invoke(
          target.pluginId,
          {
            action: 'search_products',
            input: {
              query: input.query,
              ...(input.maxPriceYuan !== undefined ? { maxPriceYuan: input.maxPriceYuan } : {}),
              sortBy: 'price_asc',
              limit: input.limitPerPlatform,
            },
            allowLive: false,
          },
          context.actor,
          `${context.requestId}-${target.pluginId}`,
          {},
          context.signal,
        );
        const widget = result.widgets[0];
        if (widget?.kind === 'product_comparison_card') {
          for (const item of widget.items) {
            collected.push({
              platform: item.platform === 'taobao' ? 'taobao' : 'jd',
              platformLabel: target.platformLabel,
              itemId: item.itemId,
              title: item.title,
              shopOrStoreName: item.shopName,
              priceCents: item.priceCents,
              fulfillmentHint: item.tags[0] ?? target.hint,
              ...(item.rating !== undefined ? { rating: item.rating } : {}),
              targetUrl: item.productUrl,
            });
          }
        }
      }

      if (registry.has('taobao_flash.commerce')) {
        const flashResult = await registry.invoke(
          'taobao_flash.commerce',
          {
            action: 'search_instant_items',
            input: {
              query: input.query,
              deliveryAddress: input.deliveryAddress,
              limit: input.limitPerPlatform,
            },
            allowLive: false,
          },
          context.actor,
          `${context.requestId}-flash`,
          {},
          context.signal,
        );
        const flashWidget = flashResult.widgets[0];
        if (flashWidget?.kind === 'instant_delivery_card') {
          for (const item of flashWidget.items) {
            if (
              input.maxPriceYuan !== undefined &&
              item.priceCents > Math.round(input.maxPriceYuan * 100)
            ) {
              continue;
            }
            collected.push({
              platform: 'taobao_flash',
              platformLabel: '淘宝闪购',
              itemId: item.itemId,
              title: item.productTitle,
              shopOrStoreName: item.storeName,
              priceCents: item.priceCents,
              fulfillmentHint: `约 ${item.etaMinutes} 分钟达`,
              targetUrl: item.orderUrl,
            });
          }
        }
      }

      collected.sort((a, b) => a.priceCents - b.priceCents);
      const bounded = collected.slice(0, 15);
      const bestPricePlatformLabel = bounded[0]?.platformLabel ?? '京东商城';
      const fastestItem = bounded.find((item) => item.platform === 'taobao_flash') ?? bounded[0];
      const fastestDeliveryPlatformLabel = fastestItem?.platformLabel ?? '淘宝闪购';

      const widget: CrossPlatformCompareWidget = {
        widgetId: `${context.widgetIdPrefix}-compare`,
        kind: 'cross_platform_compare_card',
        pluginId: 'aven.compare',
        title: `多平台比价：${input.query}`,
        query: input.query,
        bestPricePlatformLabel,
        fastestDeliveryPlatformLabel,
        providerMode: 'mock',
        requiresUserConfirmationBeforeJump: true,
        items: bounded,
      };

      return {
        providerMode: 'mock',
        summary: `已汇总 ${bounded.length} 条商品报价：最低价来自${bestPricePlatformLabel}，最快时效来自${fastestDeliveryPlatformLabel}。`,
        data: {
          query: input.query,
          total: bounded.length,
          bestPricePlatformLabel,
          fastestDeliveryPlatformLabel,
          items: bounded,
        },
        widgets: bounded.length > 0 ? [widget] : [],
      };
    },
  };

  return {
    id: 'aven.compare',
    name: '全网智能比价',
    providerName: 'AVEN 多平台比价聚合器',
    description: '并发编排淘宝、京东与淘宝闪购，在一张卡片内对比到手价与送达速度。',
    version: '1.0.0',
    category: 'commerce',
    authType: 'none',
    allowedExternalHosts: [
      'item.taobao.com',
      's.taobao.com',
      'detail.tmall.com',
      'item.jd.com',
      'search.jd.com',
      'market.m.taobao.com',
    ],
    supportsLiveAdapter: false,
    readOnly: true,
    hasLiveCredentials: () => true,
    actions: [action as PluginActionHandler<unknown, Record<string, unknown>>],
  };
}
