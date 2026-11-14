import { z } from 'zod';
import {
  ProductOfferItemSchema,
  TOOL_PERMISSIONS,
  type ProductComparisonWidget,
  type ProductOfferItem,
} from '@aven/contracts';
import type { PluginActionHandler, PluginConnector } from './registry.js';
import { sanitizeExternalPluginUrl } from './url-safety.js';

export const CommerceSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    minPriceYuan: z.number().min(0).max(1_000_000).optional(),
    maxPriceYuan: z.number().min(0).max(1_000_000).optional(),
    selfOperatedOnly: z.boolean().default(false),
    sortBy: z.enum(['relevance', 'price_asc', 'price_desc']).default('relevance'),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict()
  .refine(
    (value) =>
      value.minPriceYuan === undefined ||
      value.maxPriceYuan === undefined ||
      value.maxPriceYuan >= value.minPriceYuan,
    {
      message: 'maxPriceYuan must be greater than or equal to minPriceYuan.',
      path: ['maxPriceYuan'],
    },
  );

export const CommerceSearchOutputSchema = z
  .object({
    platform: z.enum(['taobao', 'jd']),
    query: z.string().trim().min(1).max(160),
    total: z.number().int().min(0).max(50),
    items: z.array(ProductOfferItemSchema).max(10),
  })
  .strict();

export type CommerceSearchInput = z.infer<typeof CommerceSearchInputSchema>;
export type CommerceSearchOutput = z.infer<typeof CommerceSearchOutputSchema>;

export type CommerceLiveAdapter = {
  searchProducts: (
    input: CommerceSearchInput,
    signal?: AbortSignal,
  ) => Promise<readonly ProductOfferItem[]>;
};

export type CommercePluginOptions = {
  hasCredentials?: boolean;
  liveAdapter?: CommerceLiveAdapter;
};

type CommercePlatformProfile = {
  id: 'taobao.commerce' | 'jd.commerce';
  platform: 'taobao' | 'jd';
  name: string;
  providerName: string;
  description: string;
  platformLabel: string;
  allowedHosts: readonly string[];
  mockCatalog: readonly ProductOfferItem[];
  buildSearchUrl: (query: string) => string;
};

const TAOBAO_PROFILE: CommercePlatformProfile = {
  id: 'taobao.commerce',
  platform: 'taobao',
  name: '淘宝商品检索',
  providerName: '淘宝开放平台（Taobao）',
  description: '检索淘宝/天猫商品价格、店铺口碑与优惠标签，并以只读商品对比小组件呈现。',
  platformLabel: '淘宝 / 天猫',
  allowedHosts: ['item.taobao.com', 's.taobao.com', 'detail.tmall.com'],
  buildSearchUrl: (query) => `https://s.taobao.com/search?q=${encodeURIComponent(query)}`,
  mockCatalog: [
    {
      itemId: 'tb-8801001',
      platform: 'taobao',
      title: 'Keychron K2 Pro 矮轴双模机械键盘 办公Mac适用',
      shopName: 'Keychron旗舰店',
      priceCents: 46800,
      originalPriceCents: 52800,
      currency: 'CNY',
      tags: ['官方旗舰店', '包邮', '48小时发货'],
      rating: 4.9,
      monthlySalesHint: '月销 2000+',
      productUrl: 'https://detail.tmall.com/item.htm?id=8801001',
    },
    {
      itemId: 'tb-8801002',
      platform: 'taobao',
      title: 'Sony WH-1000XM5 头戴式无线降噪耳机',
      shopName: '索尼官方旗舰店',
      priceCents: 219900,
      originalPriceCents: 249900,
      currency: 'CNY',
      tags: ['官方旗舰店', '假一赔十'],
      rating: 4.9,
      monthlySalesHint: '月销 5000+',
      productUrl: 'https://detail.tmall.com/item.htm?id=8801002',
    },
    {
      itemId: 'tb-8801003',
      platform: 'taobao',
      title: '人体工学笔记本电脑便携散热支架 铝合金折叠款',
      shopName: '绿联数码旗舰店',
      priceCents: 7900,
      originalPriceCents: 9900,
      currency: 'CNY',
      tags: ['官方旗舰店', '7天无理由'],
      rating: 4.8,
      monthlySalesHint: '月销 1万+',
      productUrl: 'https://item.taobao.com/item.htm?id=8801003',
    },
  ],
};

const JD_PROFILE: CommercePlatformProfile = {
  id: 'jd.commerce',
  platform: 'jd',
  name: '京东商品检索',
  providerName: '京东联盟 / 开放平台（JD）',
  description: '检索京东自营与品牌店铺商品价格、物流标签与评分，并以只读商品对比小组件呈现。',
  platformLabel: '京东商城',
  allowedHosts: ['item.jd.com', 'search.jd.com'],
  buildSearchUrl: (query) => `https://search.jd.com/Search?keyword=${encodeURIComponent(query)}`,
  mockCatalog: [
    {
      itemId: 'jd-10005101',
      platform: 'jd',
      title: 'Keychron K2 Pro 热插拔无线机械键盘 京东自营',
      shopName: 'Keychron京东自营旗舰店',
      priceCents: 48900,
      originalPriceCents: 54900,
      currency: 'CNY',
      tags: ['京东自营', '次日达'],
      rating: 4.9,
      monthlySalesHint: '10万+ 评价',
      productUrl: 'https://item.jd.com/10005101.html',
    },
    {
      itemId: 'jd-10005102',
      platform: 'jd',
      title: '索尼 WH-1000XM5 头戴式主动降噪蓝牙耳机',
      shopName: 'SONY京东自营官方旗舰店',
      priceCents: 214900,
      originalPriceCents: 249900,
      currency: 'CNY',
      tags: ['京东自营', '价保30天'],
      rating: 4.9,
      monthlySalesHint: '20万+ 评价',
      productUrl: 'https://item.jd.com/10005102.html',
    },
    {
      itemId: 'jd-10005103',
      platform: 'jd',
      title: '倍思 铝合金折叠笔记本散热支架',
      shopName: '倍思官方旗舰店',
      priceCents: 8900,
      originalPriceCents: 10900,
      currency: 'CNY',
      tags: ['包邮', '京东物流'],
      rating: 4.8,
      monthlySalesHint: '5万+ 评价',
      productUrl: 'https://item.jd.com/10005103.html',
    },
  ],
};

function sanitizeProductItem(
  item: ProductOfferItem,
  allowedHosts: readonly string[],
): ProductOfferItem {
  return {
    ...item,
    productUrl: sanitizeExternalPluginUrl(item.productUrl, allowedHosts),
  };
}

function queryMockCatalog(
  profile: CommercePlatformProfile,
  input: CommerceSearchInput,
): ProductOfferItem[] {
  const normalizedQuery = input.query.trim().toLowerCase();
  const minCents = input.minPriceYuan !== undefined ? Math.round(input.minPriceYuan * 100) : 0;
  const maxCents =
    input.maxPriceYuan !== undefined
      ? Math.round(input.maxPriceYuan * 100)
      : Number.MAX_SAFE_INTEGER;

  let matched = profile.mockCatalog.filter((item) => {
    const titleHit =
      item.title.toLowerCase().includes(normalizedQuery) ||
      item.shopName.toLowerCase().includes(normalizedQuery);
    const priceHit = item.priceCents >= minCents && item.priceCents <= maxCents;
    const selfOpHit =
      !input.selfOperatedOnly ||
      item.tags.some((tag) => tag.includes('自营') || tag.includes('官方'));
    return titleHit && priceHit && selfOpHit;
  });

  if (matched.length === 0) {
    const fallbackPrice = Math.min(Math.max(minCents, 9900), maxCents);
    matched = [
      {
        itemId: `${profile.platform}-mock-search-1`,
        platform: profile.platform,
        title: `${input.query.trim()}（${profile.platformLabel} 精选商品）`,
        shopName: `${profile.platformLabel}官方示范店`,
        priceCents: fallbackPrice,
        currency: 'CNY',
        tags: [input.selfOperatedOnly ? '官方自营' : '精选推荐'],
        rating: 4.8,
        productUrl: profile.buildSearchUrl(input.query.trim()),
      },
    ];
  }

  const sorted = [...matched];
  if (input.sortBy === 'price_asc') {
    sorted.sort((left, right) => left.priceCents - right.priceCents);
  } else if (input.sortBy === 'price_desc') {
    sorted.sort((left, right) => right.priceCents - left.priceCents);
  }

  return sorted
    .slice(0, input.limit)
    .map((item) => sanitizeProductItem(item, profile.allowedHosts));
}

function createCommerceConnector(
  profile: CommercePlatformProfile,
  options: CommercePluginOptions = {},
): PluginConnector {
  const hasLive = Boolean(options.hasCredentials && options.liveAdapter?.searchProducts);

  const searchProductsAction: PluginActionHandler<CommerceSearchInput, CommerceSearchOutput> = {
    name: 'search_products',
    title: '商品检索与比价',
    description: `按关键词与价格区间在${profile.platformLabel}检索商品，返回只读对比卡片（跳转外链前需用户确认）。`,
    inputSchema: CommerceSearchInputSchema,
    outputSchema: CommerceSearchOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeCommerce],
    widgetKinds: ['product_comparison_card'],
    timeoutMs: 6000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveAdapter);
      const rawItems = useLive
        ? await options.liveAdapter!.searchProducts(input, context.signal)
        : queryMockCatalog(profile, input);
      const items = rawItems
        .slice(0, input.limit)
        .map((item) => sanitizeProductItem(item, profile.allowedHosts));
      const providerMode = useLive ? 'live' : 'mock';

      const widget: ProductComparisonWidget = {
        widgetId: `${context.widgetIdPrefix}-products`,
        kind: 'product_comparison_card',
        pluginId: profile.id,
        title: `${profile.platformLabel}商品检索：${input.query}`,
        subtitle:
          providerMode === 'live'
            ? `实时接口返回 ${items.length} 条商品，外链跳转前需用户确认`
            : `精选推荐返回 ${items.length} 条商品，外链跳转前需用户确认`,
        query: input.query,
        platformLabel: profile.platformLabel,
        providerMode,
        requiresUserConfirmationBeforeJump: true,
        items,
      };

      return {
        providerMode,
        summary: `已在${profile.platformLabel}检索到 ${items.length} 件符合条件的商品。`,
        data: {
          platform: profile.platform,
          query: input.query,
          total: items.length,
          items,
        },
        widgets: items.length > 0 ? [widget] : [],
      };
    },
  };

  return {
    id: profile.id,
    name: profile.name,
    providerName: profile.providerName,
    description: profile.description,
    version: '1.0.0',
    category: 'commerce',
    authType: 'api_key',
    allowedExternalHosts: [...profile.allowedHosts],
    supportsLiveAdapter: true,
    readOnly: true,
    hasLiveCredentials: () => hasLive,
    actions: [searchProductsAction as PluginActionHandler<unknown, Record<string, unknown>>],
  };
}

export function createTaobaoPlugin(options: CommercePluginOptions = {}): PluginConnector {
  return createCommerceConnector(TAOBAO_PROFILE, options);
}

export function createJdPlugin(options: CommercePluginOptions = {}): PluginConnector {
  return createCommerceConnector(JD_PROFILE, options);
}
