import { describe, expect, it } from 'vitest';
import { TOOL_PERMISSIONS, type ToolPermission } from '@aven/contracts';
import { InMemoryToolAuditSink, ToolRegistry, type ToolActor } from '../tools.js';
import { ToolExecutor } from '../tool-executor.js';
import { createDefaultPluginRegistry } from './index.js';

function makeActor(
  permissions: readonly ToolPermission[] = [
    TOOL_PERMISSIONS.pluginReadCatalog,
    TOOL_PERMISSIONS.pluginInvokeMaps,
    TOOL_PERMISSIONS.pluginInvokeCommerce,
  ],
): ToolActor {
  return {
    principalId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    permissions: new Set(permissions),
    allowedUses: new Set(['self_ai']),
  };
}

describe('extensible plugin connectors and conversational widgets', () => {
  it('lists default maps and commerce plugins with schemas and status', () => {
    const registry = createDefaultPluginRegistry();
    const all = registry.listCatalog();
    expect(all.total).toBe(11);
    expect(all.plugins.map((plugin) => plugin.id)).toEqual([
      'amap.maps',
      'taobao.commerce',
      'jd.commerce',
      'taobao_flash.commerce',
      'meituan.lifestyle',
      'gmail.mail',
      'qqmail.mail',
      'aven.social',
      'aven.calendar',
      'aven.weather',
      'aven.compare',
    ]);

    const mapsOnly = registry.listCatalog('maps');
    expect(mapsOnly.total).toBe(1);
    expect(mapsOnly.plugins[0]?.credentialStatus).toBe('missing_credentials');
    expect(mapsOnly.plugins[0]?.actions.map((action) => action.name)).toEqual([
      'search_poi',
      'geocode',
    ]);
  });

  it('invokes amap.maps search_poi and returns a map_location_card widget with audit record', async () => {
    const registry = createDefaultPluginRegistry();
    const auditSink = new InMemoryToolAuditSink();

    const response = await registry.invoke(
      'amap.maps',
      {
        action: 'search_poi',
        input: { query: '中关村软件园', city: '北京', limit: 3 },
        allowLive: false,
      },
      makeActor(),
      'req-amap-1',
      { auditSink },
    );

    expect(response.providerMode).toBe('mock');
    expect(response.widgets).toHaveLength(1);
    expect(response.widgets[0]?.kind).toBe('map_location_card');
    if (response.widgets[0]?.kind === 'map_location_card') {
      expect(response.widgets[0].locations[0]?.formattedAddress).toContain('北京市海淀区');
      expect(response.widgets[0].locations[0]?.navigationUrl).toMatch(
        /^https:\/\/uri\.amap\.com\//,
      );
    }
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]?.toolName).toBe('plugin.amap.maps.search_poi');
    expect(auditSink.events[0]?.status).toBe('succeeded');
  });

  it('invokes taobao.commerce and jd.commerce with price filtering, sorting, and jump confirmation', async () => {
    const registry = createDefaultPluginRegistry();

    const taobaoResult = await registry.invoke(
      'taobao.commerce',
      {
        action: 'search_products',
        input: {
          query: '键盘',
          maxPriceYuan: 600,
          sortBy: 'price_asc',
          selfOperatedOnly: false,
          limit: 5,
        },
        allowLive: false,
      },
      makeActor(),
      'req-tb-1',
    );
    expect(taobaoResult.providerMode).toBe('mock');
    expect(taobaoResult.widgets[0]?.kind).toBe('product_comparison_card');
    if (taobaoResult.widgets[0]?.kind === 'product_comparison_card') {
      expect(taobaoResult.widgets[0].requiresUserConfirmationBeforeJump).toBe(true);
      expect(taobaoResult.widgets[0].items[0]?.priceCents).toBeLessThanOrEqual(60000);
    }

    const jdResult = await registry.invoke(
      'jd.commerce',
      {
        action: 'search_products',
        input: {
          query: '耳机',
          selfOperatedOnly: true,
          sortBy: 'price_desc',
          limit: 3,
        },
        allowLive: false,
      },
      makeActor(),
      'req-jd-1',
    );
    expect(jdResult.widgets[0]?.kind).toBe('product_comparison_card');
    if (jdResult.widgets[0]?.kind === 'product_comparison_card') {
      expect(jdResult.widgets[0].items[0]?.platform).toBe('jd');
      expect(jdResult.widgets[0].items[0]?.tags).toContain('京东自营');
    }
  });

  it('denies plugin execution when required permission is missing', async () => {
    const registry = createDefaultPluginRegistry();
    await expect(
      registry.invoke(
        'amap.maps',
        { action: 'geocode', input: { address: '望京SOHO' }, allowLive: false },
        makeActor([TOOL_PERMISSIONS.pluginReadCatalog]),
        'req-denied-1',
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' });
  });

  it('rejects live mode without credentials and blocks untrusted external URLs from adapters', async () => {
    const unconfigured = createDefaultPluginRegistry();
    await expect(
      unconfigured.invoke(
        'amap.maps',
        { action: 'search_poi', input: { query: '望京SOHO', limit: 1 }, allowLive: true },
        makeActor(),
        'req-live-missing',
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });

    const unsafeAdapterRegistry = createDefaultPluginRegistry({
      amap: {
        apiKey: 'test-key-only',
        liveAdapter: {
          searchPoi: async () => [
            {
              poiId: 'live-1',
              name: 'Bad Host POI',
              formattedAddress: '上海市',
              latitude: 31.23,
              longitude: 121.47,
              navigationUrl: 'https://evil.example.com/phish',
            },
          ],
        },
      },
    });

    await expect(
      unsafeAdapterRegistry.invoke(
        'amap.maps',
        { action: 'search_poi', input: { query: '测试', limit: 1 }, allowLive: true },
        makeActor(),
        'req-unsafe-url',
      ),
    ).rejects.toMatchObject({ code: 'TOOL_RESULT_INVALID' });

    const safeLiveRegistry = createDefaultPluginRegistry({
      amap: {
        apiKey: 'test-key-only',
        liveAdapter: {
          searchPoi: async () => [
            {
              poiId: 'live-2',
              name: '上海中心大厦',
              formattedAddress: '上海市浦东新区银城中路501号',
              latitude: 31.2335,
              longitude: 121.5055,
              navigationUrl: 'https://uri.amap.com/marker?position=121.5055,31.2335',
            },
          ],
        },
      },
    });

    const liveResult = await safeLiveRegistry.invoke(
      'amap.maps',
      { action: 'search_poi', input: { query: '上海中心大厦', limit: 1 }, allowLive: true },
      makeActor(),
      'req-live-ok',
    );
    expect(liveResult.providerMode).toBe('live');
    expect(liveResult.widgets[0]?.kind).toBe('map_location_card');
  });

  it('bridges registered plugins cleanly into ToolRegistry and ToolExecutor', async () => {
    const pluginRegistry = createDefaultPluginRegistry();
    const toolRegistry = new ToolRegistry();
    pluginRegistry.registerToolsInto(toolRegistry);

    expect(toolRegistry.has('plugin.amap.maps.search_poi')).toBe(true);
    expect(toolRegistry.has('plugin.taobao.commerce.search_products')).toBe(true);
    expect(toolRegistry.has('plugin.jd.commerce.search_products')).toBe(true);

    const executor = new ToolExecutor(toolRegistry);
    const audit = new InMemoryToolAuditSink();
    const result = await executor.execute<{ providerMode: string; widgets: unknown[] }>(
      'plugin.jd.commerce.search_products',
      { query: '支架', limit: 2 },
      { actor: makeActor(), requestId: 'req-tool-1', audit },
    );

    expect(result.value.providerMode).toBe('mock');
    expect(result.value.widgets).toHaveLength(1);
    expect(audit.events[0]?.status).toBe('succeeded');
  });
});
