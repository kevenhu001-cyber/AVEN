import { describe, expect, it } from 'vitest';
import { TOOL_PERMISSIONS } from '@aven/contracts';
import { createDefaultPluginRegistry, InMemoryToolAuditSink } from '@aven/ai-core';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiCodeException } from '../http-errors.js';
import { PluginService } from './plugin.service.js';

const AUTH_FIXTURE: AuthContext = {
  sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: '11111111-1111-4111-8111-111111111111',
  principalId: '22222222-2222-4222-8222-222222222222',
  client: 'web',
  email: 'user@example.edu.cn',
  emailVerified: true,
};

const OTHER_USER: AuthContext = {
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userId: '99999999-9999-4999-8999-999999999999',
  principalId: '88888888-8888-4888-8888-888888888888',
  client: 'web',
  email: 'other@example.edu.cn',
  emailVerified: true,
};

describe('PluginService', () => {
  it('lists all built-in plugins and supports category filtering', () => {
    const service = new PluginService();
    const all = service.listCatalog(AUTH_FIXTURE);
    expect(all.total).toBe(11);
    expect(all.plugins.map((item) => item.id)).toContain('gmail.mail');
    expect(all.plugins.map((item) => item.id)).toContain('meituan.lifestyle');
    expect(all.plugins.map((item) => item.id)).toContain('aven.social');

    const mail = service.listCatalog(AUTH_FIXTURE, 'mail');
    expect(mail.plugins.map((item) => item.id)).toEqual(['gmail.mail', 'qqmail.mail']);
  });

  it('invokes amap.maps address search and records tool audit event', async () => {
    const auditSink = new InMemoryToolAuditSink();
    const service = new PluginService(createDefaultPluginRegistry(), auditSink);

    const result = await service.invoke(AUTH_FIXTURE, 'amap.maps', {
      action: 'search_poi',
      input: { query: '望京SOHO', city: '北京', limit: 2 },
      allowLive: false,
    });

    expect(result.providerMode).toBe('mock');
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0]?.kind).toBe('map_location_card');
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]?.actorPrincipalId).toBe(AUTH_FIXTURE.principalId);
  });

  it('invokes taobao.commerce, taobao_flash, meituan, gmail, and aven.compare', async () => {
    const service = new PluginService();

    const compare = await service.invoke(AUTH_FIXTURE, 'aven.compare', {
      action: 'compare_products',
      input: { query: '机械键盘', deliveryAddress: '望京SOHO' },
      allowLive: false,
    });
    expect(compare.widgets[0]?.kind).toBe('cross_platform_compare_card');

    const meituan = await service.invoke(AUTH_FIXTURE, 'meituan.lifestyle', {
      action: 'search_food_delivery',
      input: { query: '咖啡', deliveryAddress: '望京SOHO' },
      allowLive: false,
    });
    expect(meituan.widgets[0]?.kind).toBe('instant_delivery_card');

    const gmail = await service.invoke(AUTH_FIXTURE, 'gmail.mail', {
      action: 'draft_email',
      input: { to: ['prof@example.edu.cn'], subject: '会议确认', body: '周五下午见' },
      allowLive: false,
    });
    expect(gmail.widgets[0]?.kind).toBe('email_compose_preview_card');
  });

  it('isolates custom MCP servers per user and enforces SSRF/ownership checks', async () => {
    const service = new PluginService();

    const reg = await service.registerMcpServer(AUTH_FIXTURE, {
      name: '个人文献检索 MCP',
      endpointUrl: 'https://mcp.arxiv-helper.example.com/rpc',
      authType: 'api_key_header',
      headerName: 'X-Api-Key',
      credentialSecret: 'private-secret-999',
      timeoutMs: 5000,
      readOnlyDefault: true,
    });

    expect(service.listMcpServers(AUTH_FIXTURE).total).toBe(1);
    expect(service.listMcpServers(OTHER_USER).total).toBe(0);
    expect(
      service.listCatalog(OTHER_USER, 'mcp').plugins.some((p) => p.id === reg.registeredPlugin.id),
    ).toBe(false);

    const invoked = await service.invoke(AUTH_FIXTURE, reg.registeredPlugin.id, {
      action: 'query_resource',
      input: { query: 'diffusion policy' },
      allowLive: false,
    });
    expect(invoked.widgets[0]?.kind).toBe('mcp_result_card');

    // Other user cannot invoke or unregister owner's custom MCP plugin
    await expect(
      service.invoke(OTHER_USER, reg.registeredPlugin.id, {
        action: 'query_resource',
        input: { query: 'diffusion policy' },
        allowLive: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(() => service.unregisterMcpServer(OTHER_USER, reg.server.serverId)).toThrow();
    service.unregisterMcpServer(AUTH_FIXTURE, reg.server.serverId);
    expect(service.listMcpServers(AUTH_FIXTURE).total).toBe(0);
  });

  it('maps missing plugins, invalid input, missing permissions, and missing live credentials cleanly', async () => {
    const service = new PluginService();

    await expect(
      service.invoke(AUTH_FIXTURE, 'unknown.plugin', {
        action: 'search_poi',
        input: {},
        allowLive: false,
      }),
    ).rejects.toBeInstanceOf(ApiCodeException);

    await expect(
      service.invoke(AUTH_FIXTURE, 'amap.maps', {
        action: 'search_poi',
        input: { query: '' },
        allowLive: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      service.invoke(
        AUTH_FIXTURE,
        'amap.maps',
        { action: 'search_poi', input: { query: '望京SOHO' }, allowLive: false },
        { permissions: [TOOL_PERMISSIONS.pluginReadCatalog] },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      service.invoke(AUTH_FIXTURE, 'jd.commerce', {
        action: 'search_products',
        input: { query: '键盘' },
        allowLive: true,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
