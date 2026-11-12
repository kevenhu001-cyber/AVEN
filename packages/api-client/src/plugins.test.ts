import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient } from './index';

describe('api-client plugins methods', () => {
  it('lists plugin catalog with optional category filter and bearer auth', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 1,
          plugins: [
            {
              id: 'amap.maps',
              name: '高德地图',
              providerName: '高德开放平台（Amap）',
              description: '地点与地址检索',
              version: '1.0.0',
              category: 'maps',
              authType: 'api_key',
              credentialStatus: 'missing_credentials',
              allowedExternalHosts: ['uri.amap.com'],
              supportsLiveAdapter: true,
              readOnly: true,
              actions: [
                {
                  name: 'search_poi',
                  title: '地点检索',
                  description: '按关键词查地址',
                  requiredPermissions: ['plugin:invoke:maps'],
                  widgetKinds: ['map_location_card'],
                  idempotent: true,
                  timeoutMs: 5000,
                  maxRetries: 1,
                  inputJsonSchema: { type: 'object' },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = createApiClient({ baseUrl: 'https://api.aven.example', fetcher: fetchMock });
    const catalog = await client.plugins.listCatalog({
      category: 'maps',
      auth: { kind: 'mobile', bearerToken: 'tok-mobile-1' },
    });

    expect(catalog.total).toBe(1);
    expect(catalog.plugins[0]?.id).toBe('amap.maps');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.aven.example/api/v1/plugins?category=maps');
    expect(init?.credentials).toBe('omit');
  });

  it('invokes plugin action with CSRF headers and validates response widget', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          invocationId: '11111111-1111-4111-8111-111111111111',
          pluginId: 'taobao.commerce',
          action: 'search_products',
          providerMode: 'mock',
          summary: '已检索到 1 件商品',
          data: { total: 1 },
          widgets: [
            {
              widgetId: 'w-1',
              kind: 'product_comparison_card',
              pluginId: 'taobao.commerce',
              title: '淘宝检索：键盘',
              query: '键盘',
              platformLabel: '淘宝 / 天猫',
              providerMode: 'mock',
              requiresUserConfirmationBeforeJump: true,
              items: [
                {
                  itemId: 'tb-1',
                  platform: 'taobao',
                  title: '无线机械键盘',
                  shopName: '示范旗舰店',
                  priceCents: 39900,
                  currency: 'CNY',
                  tags: ['包邮'],
                  productUrl: 'https://detail.tmall.com/item.htm?id=1',
                },
              ],
            },
          ],
          auditRef: 'tool:plugin.taobao.commerce.search_products:req-1',
          executedAt: '2026-11-12T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = createApiClient({ baseUrl: 'https://api.aven.example', fetcher: fetchMock });
    const response = await client.plugins.invoke(
      'taobao.commerce',
      { action: 'search_products', input: { query: '键盘' }, allowLive: false },
      { auth: { kind: 'web', csrfToken: 'csrf-123' } },
    );

    expect(response.widgets[0]?.kind).toBe('product_comparison_card');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.aven.example/api/v1/plugins/taobao.commerce/invoke');
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-123');
  });

  it('registers, lists, and deletes custom MCP servers while rejecting SSRF URLs client-side', async () => {
    const serverId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            server: {
              serverId,
              pluginId: 'mcp.srv_33333333',
              name: 'My MCP',
              endpointUrl: 'https://mcp.example.com/rpc',
              authType: 'bearer',
              hasCredential: true,
              timeoutMs: 8000,
              status: 'connected_mock',
              discoveredTools: [
                {
                  name: 'query_resource',
                  title: 'My MCP 检索',
                  description: '结构化检索',
                  readOnly: true,
                  inputJsonSchema: { type: 'object' },
                },
              ],
              createdAt: '2026-11-12T10:00:00.000Z',
            },
            registeredPlugin: {
              id: 'mcp.srv_33333333',
              name: 'My MCP (MCP)',
              providerName: '自定义 MCP（mcp.example.com）',
              description: '自定义 MCP 插件',
              version: '1.0.0',
              category: 'mcp',
              authType: 'oauth2',
              credentialStatus: 'mock_only',
              allowedExternalHosts: ['mcp.example.com'],
              supportsLiveAdapter: false,
              readOnly: true,
              actions: [
                {
                  name: 'query_resource',
                  title: 'My MCP 检索',
                  description: '结构化检索',
                  requiredPermissions: ['plugin:invoke:mcp'],
                  widgetKinds: ['mcp_result_card'],
                  idempotent: true,
                  timeoutMs: 8000,
                  maxRetries: 0,
                  inputJsonSchema: { type: 'object' },
                },
              ],
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ servers: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const client = createApiClient({ baseUrl: 'https://api.aven.example', fetcher: fetchMock });

    // Rejects loopback MCP endpoint before hitting fetch
    await expect(
      client.plugins.registerMcpServer(
        {
          name: 'Bad SSRF MCP',
          endpointUrl: 'https://127.0.0.1/mcp',
          authType: 'none',
          timeoutMs: 5000,
          readOnlyDefault: true,
        },
        { auth: { kind: 'mobile', bearerToken: 'tok-1' } },
      ),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchMock).not.toHaveBeenCalled();

    const reg = await client.plugins.registerMcpServer(
      {
        name: 'My MCP',
        endpointUrl: 'https://mcp.example.com/rpc',
        authType: 'bearer',
        credentialSecret: 'secret-tok',
        timeoutMs: 8000,
        readOnlyDefault: true,
      },
      { auth: { kind: 'mobile', bearerToken: 'tok-1' } },
    );
    expect(reg.server.pluginId).toBe('mcp.srv_33333333');

    const listed = await client.plugins.listMcpServers({
      auth: { kind: 'mobile', bearerToken: 'tok-1' },
    });
    expect(listed.total).toBe(0);
  });

  it('rejects malformed pluginId client-side without calling fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl: 'https://api.aven.example', fetcher: fetchMock });
    await expect(
      client.plugins.invoke(
        '../bad-plugin',
        { action: 'search_poi', input: {}, allowLive: false },
        { auth: { kind: 'mobile', bearerToken: 'tok-1' } },
      ),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
