import { z } from 'zod';
import {
  InstantDeliveryItemSchema,
  LocalMerchantItemSchema,
  TOOL_PERMISSIONS,
  type InstantDeliveryItem,
  type InstantDeliveryWidget,
  type LocalMerchantItem,
  type LocalMerchantWidget,
} from '@aven/contracts';
import type { PluginActionHandler, PluginConnector } from './registry.js';
import { sanitizeExternalPluginUrl } from './url-safety.js';

export const InstantSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    deliveryAddress: z.string().trim().min(1).max(200).default('当前定位地址'),
    maxEtaMinutes: z.number().int().min(10).max(240).default(90),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const InstantSearchOutputSchema = z
  .object({
    platform: z.enum(['taobao_flash', 'meituan']),
    query: z.string().trim().min(1).max(160),
    total: z.number().int().min(0).max(50),
    items: z.array(InstantDeliveryItemSchema).max(10),
  })
  .strict();

export const LocalDealSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    city: z.string().trim().min(1).max(60).default('北京市'),
    maxAvgPriceYuan: z.number().min(1).max(100_000).optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const LocalDealSearchOutputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    city: z.string().trim().min(1).max(60),
    total: z.number().int().min(0).max(50),
    merchants: z.array(LocalMerchantItemSchema).max(10),
  })
  .strict();

export type InstantSearchInput = z.infer<typeof InstantSearchInputSchema>;
export type LocalDealSearchInput = z.infer<typeof LocalDealSearchInputSchema>;

export type TaobaoFlashPluginOptions = {
  hasCredentials?: boolean;
  liveSearch?: (
    input: InstantSearchInput,
    signal?: AbortSignal,
  ) => Promise<readonly InstantDeliveryItem[]>;
};

export type MeituanPluginOptions = {
  hasCredentials?: boolean;
  liveFoodDelivery?: (
    input: InstantSearchInput,
    signal?: AbortSignal,
  ) => Promise<readonly InstantDeliveryItem[]>;
  liveLocalDeals?: (
    input: LocalDealSearchInput,
    signal?: AbortSignal,
  ) => Promise<readonly LocalMerchantItem[]>;
};

const TAOBAO_FLASH_HOSTS = ['s.taobao.com', 'detail.tmall.com', 'market.m.taobao.com'] as const;
const MEITUAN_HOSTS = [
  'waimai.meituan.com',
  'i.waimai.meituan.com',
  'www.meituan.com',
  'i.meituan.com',
  'www.dianping.com',
] as const;

const MOCK_TAOBAO_FLASH_ITEMS: readonly InstantDeliveryItem[] = [
  {
    itemId: 'tbf-3001',
    platform: 'taobao_flash',
    storeName: '罗技授权体验店（中关村店）',
    productTitle: 'Logitech 无线静音办公鼠标 · 淘宝小时达',
    priceCents: 14900,
    deliveryFeeCents: 300,
    minOrderCents: 2000,
    etaMinutes: 34,
    distanceMeters: 1850,
    tags: ['小时达', '门店现货'],
    orderUrl: 'https://s.taobao.com/search?q=%E6%97%A0%E7%BA%BF%E9%BC%A0%E6%A0%87',
  },
  {
    itemId: 'tbf-3002',
    platform: 'taobao_flash',
    storeName: '盒马鲜生（西北旺店）',
    productTitle: '冷萃黑咖啡组合 260ml*6 瓶',
    priceCents: 4590,
    deliveryFeeCents: 0,
    minOrderCents: 3900,
    etaMinutes: 28,
    distanceMeters: 1320,
    tags: ['30分钟达', '免运费'],
    orderUrl: 'https://s.taobao.com/search?q=%E5%86%B7%E8%90%83%E5%92%96%E5%95%A1',
  },
  {
    itemId: 'tbf-3003',
    platform: 'taobao_flash',
    storeName: '小米之家（五道口店）',
    productTitle: '65W GaN 氮化镓多口快充头',
    priceCents: 12900,
    deliveryFeeCents: 400,
    minOrderCents: 5000,
    etaMinutes: 42,
    distanceMeters: 3100,
    tags: ['闪购直达', '官方门店'],
    orderUrl: 'https://detail.tmall.com/item.htm?id=3003',
  },
];

const MOCK_MEITUAN_DELIVERY_ITEMS: readonly InstantDeliveryItem[] = [
  {
    itemId: 'mt-waimai-4001',
    platform: 'meituan',
    storeName: 'Manner Coffee（望京SOHO店）',
    productTitle: '冰美式 + 燕麦拿铁双杯工作餐',
    priceCents: 3600,
    deliveryFeeCents: 250,
    minOrderCents: 2000,
    etaMinutes: 25,
    distanceMeters: 620,
    tags: ['准时宝', '评分 4.9'],
    orderUrl: 'https://waimai.meituan.com/',
  },
  {
    itemId: 'mt-waimai-4002',
    platform: 'meituan',
    storeName: '轻食沙拉实验室（海淀软件园店）',
    productTitle: '低温慢煮鸡胸肉藜麦能量碗',
    priceCents: 3290,
    deliveryFeeCents: 300,
    minOrderCents: 2500,
    etaMinutes: 32,
    distanceMeters: 1180,
    tags: ['减脂轻食', '支持预约'],
    orderUrl: 'https://i.waimai.meituan.com/',
  },
];

const MOCK_MEITUAN_MERCHANTS: readonly LocalMerchantItem[] = [
  {
    merchantId: 'mt-shop-5001',
    platform: 'meituan',
    name: '山海茶点·广式融合菜（软件园店）',
    category: '粤菜/适合多人聚餐',
    city: '北京市',
    address: '北京市海淀区东北旺西路8号中关村软件园广场2层',
    rating: 4.8,
    avgPriceCents: 9800,
    dealTitle: '4人团队轻聚餐套餐（含茶位）',
    dealPriceCents: 32800,
    openStatus: '营业中 10:30-22:00',
    merchantUrl: 'https://www.meituan.com/',
  },
  {
    merchantId: 'mt-shop-5002',
    platform: 'meituan',
    name: '静隅书屋咖啡馆（清华东路店）',
    category: '安静咖啡/适合线下约谈',
    city: '北京市',
    address: '北京市海淀区清华东路16号一层东侧',
    rating: 4.9,
    avgPriceCents: 4600,
    dealTitle: '双人美式/手冲洽谈套餐',
    dealPriceCents: 6800,
    openStatus: '营业中 08:30-21:30',
    merchantUrl: 'https://www.dianping.com/',
  },
];

function sanitizeDeliveryItems(
  items: readonly InstantDeliveryItem[],
  allowedHosts: readonly string[],
): InstantDeliveryItem[] {
  return items.map((item) => ({
    ...item,
    orderUrl: sanitizeExternalPluginUrl(item.orderUrl, allowedHosts),
  }));
}

function queryInstantDelivery(
  catalog: readonly InstantDeliveryItem[],
  platform: 'taobao_flash' | 'meituan',
  input: InstantSearchInput,
  allowedHosts: readonly string[],
): InstantDeliveryItem[] {
  const q = input.query.trim().toLowerCase();
  const matched = catalog.filter(
    (item) =>
      item.etaMinutes <= input.maxEtaMinutes &&
      (item.productTitle.toLowerCase().includes(q) ||
        item.storeName.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))),
  );
  if (matched.length > 0) {
    return sanitizeDeliveryItems(matched.slice(0, input.limit), allowedHosts);
  }
  const fallbackUrl =
    platform === 'taobao_flash'
      ? `https://s.taobao.com/search?q=${encodeURIComponent(input.query.trim())}`
      : 'https://waimai.meituan.com/';
  return sanitizeDeliveryItems(
    [
      {
        itemId: `${platform}-mock-1`,
        platform,
        storeName: platform === 'taobao_flash' ? '附近闪购优选门店' : '附近美团优选门店',
        productTitle: `${input.query.trim()} · 约 ${Math.min(35, input.maxEtaMinutes)} 分钟送达`,
        priceCents: 3900,
        deliveryFeeCents: 200,
        minOrderCents: 2000,
        etaMinutes: Math.min(35, input.maxEtaMinutes),
        distanceMeters: 1200,
        tags: [platform === 'taobao_flash' ? '小时达' : '即时配送'],
        orderUrl: fallbackUrl,
      },
    ],
    allowedHosts,
  );
}

export function createTaobaoFlashPlugin(options: TaobaoFlashPluginOptions = {}): PluginConnector {
  const hasLive = Boolean(options.hasCredentials && options.liveSearch);

  const action: PluginActionHandler<
    InstantSearchInput,
    z.infer<typeof InstantSearchOutputSchema>
  > = {
    name: 'search_instant_items',
    title: '淘宝闪购即时商品检索',
    description: '按收货地址与期望配送时效检索附近淘宝闪购/小时达商品，返回即时配送小组件。',
    inputSchema: InstantSearchInputSchema,
    outputSchema: InstantSearchOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeCommerce],
    widgetKinds: ['instant_delivery_card'],
    timeoutMs: 6000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveSearch);
      const items = useLive
        ? sanitizeDeliveryItems(
            (await options.liveSearch!(input, context.signal)).slice(0, input.limit),
            TAOBAO_FLASH_HOSTS,
          )
        : queryInstantDelivery(MOCK_TAOBAO_FLASH_ITEMS, 'taobao_flash', input, TAOBAO_FLASH_HOSTS);
      const providerMode = useLive ? 'live' : 'mock';
      const widget: InstantDeliveryWidget = {
        widgetId: `${context.widgetIdPrefix}-flash`,
        kind: 'instant_delivery_card',
        pluginId: 'taobao_flash.commerce',
        title: `淘宝闪购：${input.query}`,
        query: input.query,
        deliveryAddress: input.deliveryAddress,
        providerMode,
        requiresUserConfirmationBeforeJump: true,
        items,
      };
      return {
        providerMode,
        summary: `已为地址“${input.deliveryAddress}”找到 ${items.length} 条淘宝闪购即时商品。`,
        data: {
          platform: 'taobao_flash',
          query: input.query,
          total: items.length,
          items,
        },
        widgets: [widget],
      };
    },
  };

  return {
    id: 'taobao_flash.commerce',
    name: '淘宝闪购',
    providerName: '淘宝闪购 / 小时达',
    description: '检索附近线下门店实时库存、预计送达分钟数与即时配送小组件。',
    version: '1.0.0',
    category: 'commerce',
    authType: 'api_key',
    allowedExternalHosts: [...TAOBAO_FLASH_HOSTS],
    supportsLiveAdapter: true,
    readOnly: true,
    hasLiveCredentials: () => hasLive,
    actions: [action as PluginActionHandler<unknown, Record<string, unknown>>],
  };
}

export function createMeituanPlugin(options: MeituanPluginOptions = {}): PluginConnector {
  const hasLive = Boolean(
    options.hasCredentials && (options.liveFoodDelivery || options.liveLocalDeals),
  );

  const deliveryAction: PluginActionHandler<
    InstantSearchInput,
    z.infer<typeof InstantSearchOutputSchema>
  > = {
    name: 'search_food_delivery',
    title: '美团外卖与闪送检索',
    description: '按地址与配送时间上限检索美团餐饮及即时零售，返回即时配送小组件。',
    inputSchema: InstantSearchInputSchema,
    outputSchema: InstantSearchOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeLifestyle],
    widgetKinds: ['instant_delivery_card'],
    timeoutMs: 6000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveFoodDelivery);
      const items = useLive
        ? sanitizeDeliveryItems(
            (await options.liveFoodDelivery!(input, context.signal)).slice(0, input.limit),
            MEITUAN_HOSTS,
          )
        : queryInstantDelivery(MOCK_MEITUAN_DELIVERY_ITEMS, 'meituan', input, MEITUAN_HOSTS);
      const providerMode = useLive ? 'live' : 'mock';
      const widget: InstantDeliveryWidget = {
        widgetId: `${context.widgetIdPrefix}-waimai`,
        kind: 'instant_delivery_card',
        pluginId: 'meituan.lifestyle',
        title: `美团外卖：${input.query}`,
        query: input.query,
        deliveryAddress: input.deliveryAddress,
        providerMode,
        requiresUserConfirmationBeforeJump: true,
        items,
      };
      return {
        providerMode,
        summary: `已为地址“${input.deliveryAddress}”找到 ${items.length} 家美团外卖配送方案。`,
        data: {
          platform: 'meituan',
          query: input.query,
          total: items.length,
          items,
        },
        widgets: [widget],
      };
    },
  };

  const localDealsAction: PluginActionHandler<
    LocalDealSearchInput,
    z.infer<typeof LocalDealSearchOutputSchema>
  > = {
    name: 'search_local_deals',
    title: '美团到店商户与团购检索',
    description: '检索适合约见/聚餐的美团到店商户、评分、人均消费与团购优惠卡。',
    inputSchema: LocalDealSearchInputSchema,
    outputSchema: LocalDealSearchOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeLifestyle],
    widgetKinds: ['local_merchant_card'],
    timeoutMs: 6000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveLocalDeals);
      const rawMerchants = useLive
        ? await options.liveLocalDeals!(input, context.signal)
        : MOCK_MEITUAN_MERCHANTS.filter((m) => {
            const q = input.query.trim().toLowerCase();
            const cityMatch =
              m.city.toLowerCase().includes(input.city.trim().toLowerCase()) ||
              input.city.trim().toLowerCase().includes(m.city.replace('市', '').toLowerCase());
            const budgetMatch =
              input.maxAvgPriceYuan === undefined ||
              m.avgPriceCents <= Math.round(input.maxAvgPriceYuan * 100);
            const textMatch =
              m.name.toLowerCase().includes(q) ||
              m.category.toLowerCase().includes(q) ||
              (m.dealTitle?.toLowerCase().includes(q) ?? false);
            return cityMatch && budgetMatch && textMatch;
          });

      const resolved = (rawMerchants.length > 0 ? rawMerchants : MOCK_MEITUAN_MERCHANTS.slice(0, 1))
        .slice(0, input.limit)
        .map((merchant) => ({
          ...merchant,
          merchantUrl: sanitizeExternalPluginUrl(merchant.merchantUrl, MEITUAN_HOSTS),
        }));

      const providerMode = useLive ? 'live' : 'mock';
      const widget: LocalMerchantWidget = {
        widgetId: `${context.widgetIdPrefix}-deals`,
        kind: 'local_merchant_card',
        pluginId: 'meituan.lifestyle',
        title: `美团到店推荐：${input.query}`,
        query: input.query,
        city: input.city,
        providerMode,
        requiresUserConfirmationBeforeJump: true,
        merchants: resolved,
      };
      return {
        providerMode,
        summary: `已在${input.city}检索到 ${resolved.length} 家符合条件的美团到店商户。`,
        data: {
          query: input.query,
          city: input.city,
          total: resolved.length,
          merchants: resolved,
        },
        widgets: [widget],
      };
    },
  };

  return {
    id: 'meituan.lifestyle',
    name: '美团生活服务',
    providerName: '美团开放平台（Meituan）',
    description: '覆盖外卖即时配送与线下约谈/聚餐商户团购推荐，外链跳转需用户确认。',
    version: '1.0.0',
    category: 'lifestyle',
    authType: 'api_key',
    allowedExternalHosts: [...MEITUAN_HOSTS],
    supportsLiveAdapter: true,
    readOnly: true,
    hasLiveCredentials: () => hasLive,
    actions: [
      deliveryAction as PluginActionHandler<unknown, Record<string, unknown>>,
      localDealsAction as PluginActionHandler<unknown, Record<string, unknown>>,
    ],
  };
}
