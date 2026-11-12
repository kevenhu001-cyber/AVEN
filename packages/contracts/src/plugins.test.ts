import { describe, expect, it } from 'vitest';
import {
  ConversationWidgetSchema,
  McpServerConfigCreateSchema,
  PluginInvokeRequestSchema,
  PluginInvokeResponseSchema,
  SafeHttpsUrlSchema,
  ToolPermissionSchema,
} from './index.js';

describe('plugin and widget contracts', () => {
  it('supports new plugin tool permissions', () => {
    expect(ToolPermissionSchema.safeParse('plugin:read:catalog').success).toBe(true);
    expect(ToolPermissionSchema.safeParse('plugin:invoke:maps').success).toBe(true);
    expect(ToolPermissionSchema.safeParse('plugin:invoke:commerce').success).toBe(true);
    expect(ToolPermissionSchema.safeParse('plugin:read:mail').success).toBe(true);
    expect(ToolPermissionSchema.safeParse('plugin:send:mail').success).toBe(true);
    expect(ToolPermissionSchema.safeParse('plugin:manage:mcp').success).toBe(true);
  });

  it('rejects unsafe external URLs in SafeHttpsUrlSchema', () => {
    expect(SafeHttpsUrlSchema.safeParse('https://uri.amap.com/marker?name=Test').success).toBe(
      true,
    );
    expect(SafeHttpsUrlSchema.safeParse('http://uri.amap.com/marker').success).toBe(false);
    expect(SafeHttpsUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(SafeHttpsUrlSchema.safeParse('https://127.0.0.1/internal').success).toBe(false);
    expect(SafeHttpsUrlSchema.safeParse('https://user:pass@item.taobao.com/item.htm').success).toBe(
      false,
    );
  });

  it('validates map_location_card and product_comparison_card widgets', () => {
    const mapWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-map-1',
      kind: 'map_location_card',
      pluginId: 'amap.maps',
      title: '高德地图地点查询结果',
      query: '中关村软件园',
      city: '北京',
      providerMode: 'mock',
      sourceAttribution: '高德地图（Mock 样例）',
      locations: [
        {
          poiId: 'B000A8UIN8',
          name: '中关村软件园',
          formattedAddress: '北京市海淀区东北旺西路8号',
          city: '北京市',
          district: '海淀区',
          category: '产业园区',
          latitude: 40.0488,
          longitude: 116.2983,
          navigationUrl: 'https://uri.amap.com/marker?position=116.2983,40.0488',
        },
      ],
    });
    expect(mapWidget.kind).toBe('map_location_card');

    const productWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-prod-1',
      kind: 'product_comparison_card',
      pluginId: 'jd.commerce',
      title: '京东商品检索结果',
      query: '机械键盘',
      platformLabel: '京东',
      providerMode: 'mock',
      requiresUserConfirmationBeforeJump: true,
      items: [
        {
          itemId: 'jd-10001',
          platform: 'jd',
          title: 'Keychron K2 无线机械键盘',
          shopName: 'Keychron京东自营旗舰店',
          priceCents: 49800,
          currency: 'CNY',
          tags: ['京东自营', '次日达'],
          rating: 4.9,
          productUrl: 'https://item.jd.com/100012345678.html',
        },
      ],
    });
    expect(productWidget.kind).toBe('product_comparison_card');
  });

  it('parses plugin invoke request and response envelopes', () => {
    const req = PluginInvokeRequestSchema.parse({
      action: 'search_poi',
      input: { query: '望京SOHO', city: '北京' },
    });
    expect(req.allowLive).toBe(false);

    const res = PluginInvokeResponseSchema.parse({
      invocationId: '11111111-1111-4111-8111-111111111111',
      pluginId: 'amap.maps',
      action: 'search_poi',
      providerMode: 'mock',
      summary: '找到 1 个相关地点',
      data: { total: 1 },
      widgets: [],
      auditRef: 'audit:amap.maps:search_poi',
      executedAt: '2026-11-12T10:00:00.000Z',
    });
    expect(res.providerMode).toBe('mock');
  });

  it('validates extended mail, lifestyle, social, compare, weather and mcp widgets', () => {
    const emailThreads = ConversationWidgetSchema.parse({
      widgetId: 'w-mail-list-1',
      kind: 'email_thread_list_card',
      pluginId: 'gmail.mail',
      title: 'Gmail 邮件检索结果',
      mailboxProvider: 'gmail',
      query: '发票',
      providerMode: 'mock',
      threads: [
        {
          threadId: 'th-1',
          fromLabel: 'finance@example.com',
          subject: '10 月差旅发票已开具',
          snippet: '请查收附件 PDF 电子发票',
          receivedAt: '2026-11-12T08:00:00.000Z',
          unread: true,
          hasAttachments: true,
        },
      ],
    });
    expect(emailThreads.kind).toBe('email_thread_list_card');

    const emailDraft = ConversationWidgetSchema.parse({
      widgetId: 'w-mail-draft-1',
      kind: 'email_compose_preview_card',
      pluginId: 'qqmail.mail',
      title: 'QQ 邮箱发送前确认',
      draftId: 'draft-1',
      mailboxProvider: 'qqmail',
      to: ['mentor@example.com'],
      subject: '周报沟通',
      bodyPreview: '本周已完成连接器验证。',
      status: 'draft_preview',
      requiresUserConfirmation: true,
      providerMode: 'mock',
    });
    expect(emailDraft.kind).toBe('email_compose_preview_card');

    const flashWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-flash-1',
      kind: 'instant_delivery_card',
      pluginId: 'taobao_flash.commerce',
      title: '淘宝闪购周边商品',
      query: '无糖咖啡',
      deliveryAddress: '北京市海淀区中关村',
      providerMode: 'mock',
      requiresUserConfirmationBeforeJump: true,
      items: [
        {
          itemId: 'tf-1',
          platform: 'taobao_flash',
          storeName: '便利蜂（中关村店）',
          productTitle: '三顿半冷萃美式 6 颗装',
          priceCents: 3900,
          deliveryFeeCents: 400,
          minOrderCents: 2000,
          etaMinutes: 28,
          distanceMeters: 620,
          tags: ['28 分钟送达'],
          orderUrl: 'https://m.tb.cn/h.flash001',
        },
      ],
    });
    expect(flashWidget.kind).toBe('instant_delivery_card');

    const meituanWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-meituan-1',
      kind: 'local_merchant_card',
      pluginId: 'meituan.lifestyle',
      title: '美团周边商户推荐',
      query: '咖啡自习室',
      city: '北京',
      providerMode: 'mock',
      requiresUserConfirmationBeforeJump: true,
      merchants: [
        {
          merchantId: 'mt-1',
          platform: 'meituan',
          name: '静隅咖啡自习室',
          category: '咖啡厅',
          city: '北京',
          address: '海淀区中关村大街 18 号',
          rating: 4.8,
          avgPriceCents: 4200,
          dealTitle: '单人全天饮品券',
          dealPriceCents: 3800,
          openStatus: '营业中 08:00-22:30',
          merchantUrl: 'https://www.meituan.com/shop/10001',
        },
      ],
    });
    expect(meituanWidget.kind).toBe('local_merchant_card');

    const socialWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-social-1',
      kind: 'social_connection_card',
      pluginId: 'aven.social',
      title: '认识新朋友预览',
      mode: 'suggestion_preview',
      targetUserId: '22222222-2222-4222-8222-222222222222',
      displayName: '林致远',
      headline: '具身智能系统工程师',
      matchReason: '都在关注机器人学习与开源硬件',
      purpose: 'connection_invitation',
      status: 'preview',
      selectedFields: ['name', 'interest'],
      expiresInDays: 7,
      privacyNotice: '仅展示你勾选的最小字段，确认后才会发送。',
      providerMode: 'mock',
    });
    expect(socialWidget.kind).toBe('social_connection_card');

    const compareWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-compare-1',
      kind: 'cross_platform_compare_card',
      pluginId: 'aven.compare',
      title: '跨平台比价：蓝牙耳机',
      query: '蓝牙耳机',
      bestPricePlatformLabel: '淘宝',
      fastestDeliveryPlatformLabel: '淘宝闪购',
      providerMode: 'mock',
      requiresUserConfirmationBeforeJump: true,
      items: [
        {
          platform: 'taobao',
          platformLabel: '淘宝',
          itemId: 'tb-9001',
          title: '降噪蓝牙耳机 Pro',
          shopOrStoreName: '声学官方旗舰店',
          priceCents: 29900,
          fulfillmentHint: '快递 48 小时内发货',
          rating: 4.8,
          targetUrl: 'https://detail.tmall.com/item.htm?id=9001',
        },
      ],
    });
    expect(compareWidget.kind).toBe('cross_platform_compare_card');

    const weatherWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-weather-1',
      kind: 'weather_travel_card',
      pluginId: 'aven.weather',
      title: '明日北京天气与出行建议',
      city: '北京',
      dateLabel: '明天',
      condition: '晴间多云',
      tempMinC: 4,
      tempMaxC: 15,
      commuteAdvice: '早晚偏凉建议加外套，路面干燥适合步行或骑行。',
      providerMode: 'mock',
    });
    expect(weatherWidget.kind).toBe('weather_travel_card');

    const mcpWidget = ConversationWidgetSchema.parse({
      widgetId: 'w-mcp-1',
      kind: 'mcp_result_card',
      pluginId: 'mcp.lab.papers',
      title: '实验室论文检索 MCP',
      serverId: '33333333-3333-4333-8333-333333333333',
      serverName: '实验室论文检索 MCP',
      toolName: 'search_papers',
      displayMode: 'key_value',
      summaryText: '命中 2 篇相关论文',
      rows: [{ label: 'top_paper', value: 'Diffusion Policy for Mobile Manipulation' }],
      readOnly: true,
      externalNotice: '来自用户登记的外部 MCP 工具（只读沙箱渲染）',
      providerMode: 'mock',
    });
    expect(mcpWidget.kind).toBe('mcp_result_card');
  });

  it('validates McpServerConfigCreateSchema with SSRF and credential rules', () => {
    expect(
      McpServerConfigCreateSchema.safeParse({
        name: '论文检索服务',
        endpointUrl: 'https://mcp.papers.example.com/sse',
        authType: 'none',
      }).success,
    ).toBe(true);

    expect(
      McpServerConfigCreateSchema.safeParse({
        name: '内网元数据探针',
        endpointUrl: 'https://169.254.169.254/latest/meta-data',
        authType: 'none',
      }).success,
    ).toBe(false);

    expect(
      McpServerConfigCreateSchema.safeParse({
        name: '环回地址服务',
        endpointUrl: 'https://localhost:8443/mcp',
        authType: 'none',
      }).success,
    ).toBe(false);

    expect(
      McpServerConfigCreateSchema.safeParse({
        name: '缺密钥 Bearer MCP',
        endpointUrl: 'https://mcp.example.com/v1',
        authType: 'bearer',
      }).success,
    ).toBe(false);
  });
});
