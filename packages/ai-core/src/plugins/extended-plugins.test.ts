import { describe, expect, it } from 'vitest';
import { TOOL_PERMISSIONS } from '@aven/contracts';
import type { ToolActor } from '../tools.js';
import { McpPluginManager, createDefaultPluginRegistry } from './index.js';

function makeFullActor(): ToolActor {
  return {
    principalId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    permissions: new Set([
      TOOL_PERMISSIONS.pluginReadCatalog,
      TOOL_PERMISSIONS.pluginInvokeMaps,
      TOOL_PERMISSIONS.pluginInvokeCommerce,
      TOOL_PERMISSIONS.pluginInvokeCalendar,
      TOOL_PERMISSIONS.pluginReadMail,
      TOOL_PERMISSIONS.pluginWriteMailDraft,
      TOOL_PERMISSIONS.pluginSendMail,
      TOOL_PERMISSIONS.pluginInvokeLifestyle,
      TOOL_PERMISSIONS.pluginInvokeSocial,
      TOOL_PERMISSIONS.pluginManageMcp,
      TOOL_PERMISSIONS.pluginInvokeMcp,
    ]),
    allowedUses: new Set(['self_ai']),
  };
}

describe('mail, lifestyle, social, cross-compare, and custom MCP plugins', () => {
  it('supports gmail.mail and qqmail.mail search, draft preview, and strict confirmation gate', async () => {
    const registry = createDefaultPluginRegistry();
    const actor = makeFullActor();

    const search = await registry.invoke(
      'gmail.mail',
      { action: 'search_threads', input: { query: '周会', unreadOnly: true }, allowLive: false },
      actor,
      'req-gm-1',
    );
    expect(search.widgets[0]?.kind).toBe('email_thread_list_card');

    const draft = await registry.invoke(
      'qqmail.mail',
      {
        action: 'draft_email',
        input: {
          to: ['lin@example.edu.cn'],
          subject: '周五实验材料',
          body: '请查收本周测试报告摘要。',
        },
        allowLive: false,
      },
      actor,
      'req-qq-draft',
    );
    expect(draft.widgets[0]?.kind).toBe('email_compose_preview_card');
    if (draft.widgets[0]?.kind === 'email_compose_preview_card') {
      expect(draft.widgets[0].status).toBe('draft_preview');
      expect(draft.widgets[0].requiresUserConfirmation).toBe(true);
    }

    await expect(
      registry.invoke(
        'qqmail.mail',
        {
          action: 'send_email',
          input: {
            draftId: 'draft-1',
            to: ['lin@example.edu.cn'],
            subject: '周五实验材料',
            body: '测试正文',
            confirmed: false,
          },
          allowLive: false,
        },
        actor,
        'req-qq-unconfirmed',
      ),
    ).rejects.toMatchObject({ code: 'TOOL_VALIDATION_FAILED' });

    const sent = await registry.invoke(
      'qqmail.mail',
      {
        action: 'send_email',
        input: {
          draftId: 'draft-1',
          to: ['lin@example.edu.cn'],
          subject: '周五实验材料',
          body: '测试正文',
          confirmed: true,
        },
        allowLive: false,
      },
      actor,
      'req-qq-send',
    );
    expect(sent.widgets[0]?.kind).toBe('email_compose_preview_card');
    if (sent.widgets[0]?.kind === 'email_compose_preview_card') {
      expect(sent.widgets[0].status).toBe('sent');
    }
  });

  it('supports taobao_flash.commerce, meituan.lifestyle, and cross-platform comparison', async () => {
    const registry = createDefaultPluginRegistry();
    const actor = makeFullActor();

    const flash = await registry.invoke(
      'taobao_flash.commerce',
      {
        action: 'search_instant_items',
        input: { query: '咖啡', deliveryAddress: '望京SOHO T1' },
        allowLive: false,
      },
      actor,
      'req-flash-1',
    );
    expect(flash.widgets[0]?.kind).toBe('instant_delivery_card');

    const deals = await registry.invoke(
      'meituan.lifestyle',
      {
        action: 'search_local_deals',
        input: { query: '聚餐', city: '北京' },
        allowLive: false,
      },
      actor,
      'req-mt-1',
    );
    expect(deals.widgets[0]?.kind).toBe('local_merchant_card');

    const compare = await registry.invoke(
      'aven.compare',
      {
        action: 'compare_products',
        input: { query: '机械键盘', deliveryAddress: '中关村软件园' },
        allowLive: false,
      },
      actor,
      'req-cmp-1',
    );
    expect(compare.widgets[0]?.kind).toBe('cross_platform_compare_card');
    if (compare.widgets[0]?.kind === 'cross_platform_compare_card') {
      expect(compare.widgets[0].items.length).toBeGreaterThanOrEqual(2);
      expect(compare.widgets[0].requiresUserConfirmationBeforeJump).toBe(true);
    }
  });

  it('supports aven.social, aven.calendar, and aven.weather widgets', async () => {
    const registry = createDefaultPluginRegistry();
    const actor = makeFullActor();

    const social = await registry.invoke(
      'aven.social',
      {
        action: 'preview_connection',
        input: {
          targetUserId: '33333333-3333-4333-8333-333333333333',
          displayName: '许宁',
          headline: '具身智能 / ROS2 工程师',
          matchReason: '都在关注机器人抓取实验与多模态规划',
        },
        allowLive: false,
      },
      actor,
      'req-soc-1',
    );
    expect(social.widgets[0]?.kind).toBe('social_connection_card');

    const calendar = await registry.invoke(
      'aven.calendar',
      {
        action: 'coordinate_schedule',
        input: {
          prompt: '明天下午约 60 分钟讨论项目',
          referenceNow: '2026-11-12T08:00:00.000Z',
        },
        allowLive: false,
      },
      actor,
      'req-cal-1',
    );
    expect(calendar.widgets[0]?.kind).toBe('schedule_candidates_card');
    if (calendar.widgets[0]?.kind === 'schedule_candidates_card') {
      expect(calendar.widgets[0].externalCalendarsModified).toBe(false);
    }

    const weather = await registry.invoke(
      'aven.weather',
      { action: 'get_forecast', input: { city: '北京市', dateLabel: '明天' }, allowLive: false },
      actor,
      'req-weather-1',
    );
    expect(weather.widgets[0]?.kind).toBe('weather_travel_card');
  });

  it('manages custom MCP servers with SSRF protection, secret redaction, and ownership isolation', async () => {
    const registry = createDefaultPluginRegistry();
    const manager = new McpPluginManager(registry);
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const otherUserId = '99999999-9999-4999-8999-999999999999';

    // Block SSRF private/loopback URLs
    await expect(
      manager.registerServer(ownerId, {
        name: 'Local SSRF',
        endpointUrl: 'https://127.0.0.1:8080/mcp',
        authType: 'none',
        timeoutMs: 5000,
        readOnlyDefault: true,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_VALIDATION_FAILED' });

    await expect(
      manager.registerServer(ownerId, {
        name: 'Metadata SSRF',
        endpointUrl: 'https://169.254.169.254/latest/meta-data',
        authType: 'none',
        timeoutMs: 5000,
        readOnlyDefault: true,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_VALIDATION_FAILED' });

    const registered = await manager.registerServer(ownerId, {
      name: 'Lab Paper Search MCP',
      endpointUrl: 'https://mcp.papers.example.com/sse',
      authType: 'bearer',
      credentialSecret: 'super-secret-token-should-not-leak',
      timeoutMs: 6000,
      readOnlyDefault: true,
    });

    expect(registered.server.hasCredential).toBe(true);
    expect(JSON.stringify(registered)).not.toContain('super-secret-token-should-not-leak');
    expect(manager.canUserAccessPlugin(ownerId, registered.registeredPlugin.id)).toBe(true);
    expect(manager.canUserAccessPlugin(otherUserId, registered.registeredPlugin.id)).toBe(false);

    const mcpResult = await registry.invoke(
      registered.registeredPlugin.id,
      {
        action: 'query_resource',
        input: { query: 'embodied navigation' },
        allowLive: false,
      },
      makeFullActor(),
      'req-mcp-1',
    );
    expect(mcpResult.widgets[0]?.kind).toBe('mcp_result_card');

    expect(() => manager.unregisterServer(otherUserId, registered.server.serverId)).toThrow();
    manager.unregisterServer(ownerId, registered.server.serverId);
    expect(registry.has(registered.registeredPlugin.id)).toBe(false);
  });
});
