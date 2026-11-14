import { z } from 'zod';
import {
  MapLocationItemSchema,
  TOOL_PERMISSIONS,
  type MapLocationItem,
  type MapLocationWidget,
} from '@aven/contracts';
import type { PluginActionHandler, PluginConnector } from './registry.js';
import { sanitizeExternalPluginUrl } from './url-safety.js';

const AMAP_ALLOWED_HOSTS = ['uri.amap.com', 'ditu.amap.com', 'www.amap.com'] as const;

export const AmapPoiSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    city: z.string().trim().min(1).max(60).optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const AmapGeocodeInputSchema = z
  .object({
    address: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

export const AmapLocationOutputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(60).optional(),
    total: z.number().int().min(0).max(50),
    locations: z.array(MapLocationItemSchema).max(10),
  })
  .strict();

export type AmapPoiSearchInput = z.infer<typeof AmapPoiSearchInputSchema>;
export type AmapGeocodeInput = z.infer<typeof AmapGeocodeInputSchema>;
export type AmapLocationOutput = z.infer<typeof AmapLocationOutputSchema>;

export type AmapLiveAdapter = {
  searchPoi?: (
    input: AmapPoiSearchInput,
    signal?: AbortSignal,
  ) => Promise<readonly MapLocationItem[]>;
  geocode?: (input: AmapGeocodeInput, signal?: AbortSignal) => Promise<readonly MapLocationItem[]>;
};

export type AmapPluginOptions = {
  apiKey?: string;
  liveAdapter?: AmapLiveAdapter;
};

const MOCK_AMAP_PLACES: readonly MapLocationItem[] = [
  {
    poiId: 'B000A8UIN8',
    name: '中关村软件园一期',
    formattedAddress: '北京市海淀区东北旺西路8号',
    province: '北京市',
    city: '北京市',
    district: '海淀区',
    category: '商务住宅;产业园区',
    latitude: 40.0488,
    longitude: 116.2983,
    navigationUrl: 'https://uri.amap.com/marker?position=116.2983,40.0488&name=中关村软件园一期',
  },
  {
    poiId: 'B000A83C62',
    name: '望京SOHO',
    formattedAddress: '北京市朝阳区望京街10号',
    province: '北京市',
    city: '北京市',
    district: '朝阳区',
    category: '商务住宅;楼宇;写字楼',
    latitude: 39.9964,
    longitude: 116.4809,
    navigationUrl: 'https://uri.amap.com/marker?position=116.4809,39.9964&name=望京SOHO',
  },
  {
    poiId: 'B00155L4J9',
    name: '张江科学城人工智能岛',
    formattedAddress: '上海市浦东新区川和路55弄',
    province: '上海市',
    city: '上海市',
    district: '浦东新区',
    category: '商务住宅;产业园区',
    latitude: 31.2015,
    longitude: 121.6134,
    navigationUrl:
      'https://uri.amap.com/marker?position=121.6134,31.2015&name=张江科学城人工智能岛',
  },
  {
    poiId: 'B0FFH3R9N2',
    name: '西湖文化广场',
    formattedAddress: '浙江省杭州市拱墅区中山北路581号',
    province: '浙江省',
    city: '杭州市',
    district: '拱墅区',
    category: '风景名胜;城市广场',
    latitude: 30.2797,
    longitude: 120.1636,
    navigationUrl: 'https://uri.amap.com/marker?position=120.1636,30.2797&name=西湖文化广场',
  },
  {
    poiId: 'B02F38V90A',
    name: '深圳湾科技生态园',
    formattedAddress: '广东省深圳市南山区沙河西路1819号',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    category: '商务住宅;产业园区',
    latitude: 22.5284,
    longitude: 113.9522,
    navigationUrl: 'https://uri.amap.com/marker?position=113.9522,22.5284&name=深圳湾科技生态园',
  },
];

function filterMockPlaces(
  query: string,
  city: string | undefined,
  limit: number,
): MapLocationItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCity = city?.trim().toLowerCase();

  const matches = MOCK_AMAP_PLACES.filter((place) => {
    const cityHit =
      !normalizedCity ||
      (place.city?.toLowerCase().includes(normalizedCity) ?? false) ||
      (place.province?.toLowerCase().includes(normalizedCity) ?? false);
    if (!cityHit) return false;
    return (
      place.name.toLowerCase().includes(normalizedQuery) ||
      place.formattedAddress.toLowerCase().includes(normalizedQuery) ||
      (place.district?.toLowerCase().includes(normalizedQuery) ?? false) ||
      (place.category?.toLowerCase().includes(normalizedQuery) ?? false)
    );
  });

  if (matches.length > 0) {
    return matches.slice(0, limit).map((item) => sanitizeLocation(item));
  }

  const cityLabel = city?.trim() || '北京市';
  const fallbackName = query.trim();
  const encodedName = encodeURIComponent(fallbackName);
  const fallback: MapLocationItem = {
    poiId: 'MOCK-AMAP-001',
    name: fallbackName,
    formattedAddress: `${cityLabel}核心区${fallbackName}`,
    city: cityLabel,
    category: '推荐地址检索结果',
    latitude: 39.9042,
    longitude: 116.4074,
    navigationUrl: `https://uri.amap.com/marker?position=116.4074,39.9042&name=${encodedName}`,
  };
  return [sanitizeLocation(fallback)];
}

function sanitizeLocation(item: MapLocationItem): MapLocationItem {
  return {
    ...item,
    ...(item.navigationUrl
      ? { navigationUrl: sanitizeExternalPluginUrl(item.navigationUrl, AMAP_ALLOWED_HOSTS) }
      : {}),
  };
}

function buildLocationWidget(params: {
  widgetId: string;
  title: string;
  query: string;
  city?: string;
  providerMode: 'mock' | 'live';
  locations: readonly MapLocationItem[];
}): MapLocationWidget {
  return {
    widgetId: params.widgetId,
    kind: 'map_location_card',
    pluginId: 'amap.maps',
    title: params.title,
    ...(params.city ? { subtitle: `城市范围：${params.city}` } : {}),
    query: params.query,
    ...(params.city ? { city: params.city } : {}),
    providerMode: params.providerMode,
    sourceAttribution:
      params.providerMode === 'live' ? '高德地图开放平台' : '高德地图（智能推荐数据）',
    locations: params.locations.map((item) => sanitizeLocation(item)),
  };
}

export function createAmapPlugin(options: AmapPluginOptions = {}): PluginConnector {
  const hasLive = Boolean(
    options.apiKey?.trim() && (options.liveAdapter?.searchPoi || options.liveAdapter?.geocode),
  );

  const searchPoiAction: PluginActionHandler<AmapPoiSearchInput, AmapLocationOutput> = {
    name: 'search_poi',
    title: '地点与地址检索',
    description: '按关键词和城市检索高德地图地点、详细地址、坐标与安全导航链接。',
    inputSchema: AmapPoiSearchInputSchema,
    outputSchema: AmapLocationOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeMaps],
    widgetKinds: ['map_location_card'],
    timeoutMs: 5000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveAdapter?.searchPoi);
      const rawLocations = useLive
        ? await options.liveAdapter!.searchPoi!(input, context.signal)
        : filterMockPlaces(input.query, input.city, input.limit);
      const locations = rawLocations.slice(0, input.limit).map((item) => sanitizeLocation(item));
      const providerMode = useLive ? 'live' : 'mock';
      const widget = buildLocationWidget({
        widgetId: `${context.widgetIdPrefix}-poi`,
        title: `高德地址检索：${input.query}`,
        query: input.query,
        ...(input.city ? { city: input.city } : {}),
        providerMode,
        locations,
      });

      return {
        providerMode,
        summary: `已通过高德地图检索到 ${locations.length} 个匹配地点。`,
        data: {
          query: input.query,
          ...(input.city ? { city: input.city } : {}),
          total: locations.length,
          locations,
        },
        widgets: [widget],
      };
    },
  };

  const geocodeAction: PluginActionHandler<AmapGeocodeInput, AmapLocationOutput> = {
    name: 'geocode',
    title: '地址结构化解析',
    description: '将自然语言地址解析为标准省市区地址与经纬度坐标，展示地图定位卡片。',
    inputSchema: AmapGeocodeInputSchema,
    outputSchema: AmapLocationOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeMaps],
    widgetKinds: ['map_location_card'],
    timeoutMs: 5000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveAdapter?.geocode);
      const rawLocations = useLive
        ? await options.liveAdapter!.geocode!(input, context.signal)
        : filterMockPlaces(input.address, input.city, 1);
      const locations = rawLocations.slice(0, 3).map((item) => sanitizeLocation(item));
      const providerMode = useLive ? 'live' : 'mock';
      const widget = buildLocationWidget({
        widgetId: `${context.widgetIdPrefix}-geo`,
        title: `高德地址解析：${input.address}`,
        query: input.address,
        ...(input.city ? { city: input.city } : {}),
        providerMode,
        locations,
      });

      return {
        providerMode,
        summary:
          locations[0] !== undefined
            ? `已解析地址：${locations[0].formattedAddress}`
            : '未匹配到明确地址。',
        data: {
          query: input.address,
          ...(input.city ? { city: input.city } : {}),
          total: locations.length,
          locations,
        },
        widgets: locations.length > 0 ? [widget] : [],
      };
    },
  };

  return {
    id: 'amap.maps',
    name: '高德地图',
    providerName: '高德开放平台（Amap）',
    description: '提供地址解析、POI 地点查询与安全地图导航小组件，不读写个人日程或位置历史。',
    version: '1.0.0',
    category: 'maps',
    authType: 'api_key',
    allowedExternalHosts: [...AMAP_ALLOWED_HOSTS],
    supportsLiveAdapter: true,
    readOnly: true,
    hasLiveCredentials: () => hasLive,
    actions: [
      searchPoiAction as PluginActionHandler<unknown, Record<string, unknown>>,
      geocodeAction as PluginActionHandler<unknown, Record<string, unknown>>,
    ],
  };
}
