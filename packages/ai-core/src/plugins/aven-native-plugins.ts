import { z } from 'zod';
import {
  IanaTimeZoneSchema,
  TOOL_PERMISSIONS,
  type ScheduleCandidatesWidget,
  type SocialConnectionWidget,
  type WeatherTravelWidget,
} from '@aven/contracts';
import { parseDeterministicEventConstraints } from '../event-coordination.js';
import type { PluginActionHandler, PluginConnector } from './registry.js';

export const SocialPreviewInputSchema = z
  .object({
    targetUserId: z.uuid(),
    displayName: z.string().trim().min(1).max(120),
    headline: z.string().trim().min(1).max(240),
    matchReason: z.string().trim().min(1).max(240),
    selectedFields: z
      .array(z.string().trim().min(1).max(60))
      .min(1)
      .max(12)
      .default(['姓名与头像', '近期关注方向']),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();

export const SocialPreviewOutputSchema = z
  .object({
    targetUserId: z.uuid(),
    purpose: z.literal('connection_invitation'),
    status: z.literal('preview'),
    selectedFieldCount: z.number().int().min(1).max(12),
  })
  .strict();

export const SocialStatusInputSchema = z
  .object({
    targetUserId: z.uuid(),
    displayName: z.string().trim().min(1).max(120),
    headline: z.string().trim().min(1).max(240),
    status: z.enum(['pending', 'accepted', 'declined', 'revoked']),
    selectedFields: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();

export const SocialStatusOutputSchema = z
  .object({
    targetUserId: z.uuid(),
    purpose: z.literal('connection_invitation'),
    status: z.enum(['pending', 'accepted', 'declined', 'revoked']),
  })
  .strict();

export const CalendarPluginInputSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1000),
    defaultTimezone: IanaTimeZoneSchema.default('Asia/Shanghai'),
    referenceNow: z.iso.datetime().optional(),
  })
  .strict();

export const CalendarPluginOutputSchema = z
  .object({
    status: z.enum(['needs_clarification', 'candidates_ready', 'no_common_slots']),
    timezone: IanaTimeZoneSchema,
    candidateCount: z.number().int().min(0).max(10),
  })
  .strict();

export const WeatherForecastInputSchema = z
  .object({
    city: z.string().trim().min(1).max(60),
    dateLabel: z.string().trim().min(1).max(40).default('明天'),
  })
  .strict();

export const WeatherForecastOutputSchema = z
  .object({
    city: z.string().trim().min(1).max(60),
    dateLabel: z.string().trim().min(1).max(40),
    condition: z.string().trim().min(1).max(60),
    tempMinC: z.number(),
    tempMaxC: z.number(),
  })
  .strict();

export function createAvenSocialPlugin(): PluginConnector {
  const previewAction: PluginActionHandler<
    z.infer<typeof SocialPreviewInputSchema>,
    z.infer<typeof SocialPreviewOutputSchema>
  > = {
    name: 'preview_connection',
    title: '生成社交连接授权预览小组件',
    description:
      '生成带显式字段勾选和用途边界提示的“或许可以认识一下”社交连接卡片，不直接外发邀请。',
    inputSchema: SocialPreviewInputSchema,
    outputSchema: SocialPreviewOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeSocial],
    widgetKinds: ['social_connection_card'],
    timeoutMs: 3000,
    maxRetries: 0,
    idempotent: true,
    execute: async (input, context) => {
      const widget: SocialConnectionWidget = {
        widgetId: `${context.widgetIdPrefix}-social-preview`,
        kind: 'social_connection_card',
        pluginId: 'aven.social',
        title: '或许可以认识一下 · 发送前预览',
        mode: 'suggestion_preview',
        targetUserId: input.targetUserId,
        displayName: input.displayName,
        headline: input.headline,
        matchReason: input.matchReason,
        purpose: 'connection_invitation',
        status: 'preview',
        selectedFields: input.selectedFields,
        expiresInDays: input.expiresInDays,
        privacyNotice: '仅用于本次连接邀请，不会自动共享私人记忆或扩大关系权限。',
        providerMode: 'mock',
      };
      return {
        providerMode: 'mock',
        summary: `已为你生成与“${input.displayName}”的连接邀请前共享预览卡（尚未发送）。`,
        data: {
          targetUserId: input.targetUserId,
          purpose: 'connection_invitation',
          status: 'preview',
          selectedFieldCount: input.selectedFields.length,
        },
        widgets: [widget],
      };
    },
  };

  const statusAction: PluginActionHandler<
    z.infer<typeof SocialStatusInputSchema>,
    z.infer<typeof SocialStatusOutputSchema>
  > = {
    name: 'check_connection',
    title: '展示社交连接状态小组件',
    description: '以对话内卡片形式展示连接邀请双方决定态、共享快照范围与可撤销说明。',
    inputSchema: SocialStatusInputSchema,
    outputSchema: SocialStatusOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeSocial],
    widgetKinds: ['social_connection_card'],
    timeoutMs: 3000,
    maxRetries: 0,
    idempotent: true,
    execute: async (input, context) => {
      const widget: SocialConnectionWidget = {
        widgetId: `${context.widgetIdPrefix}-social-status`,
        kind: 'social_connection_card',
        pluginId: 'aven.social',
        title: `连接卡片 · ${input.displayName}`,
        mode: 'invitation_status',
        targetUserId: input.targetUserId,
        displayName: input.displayName,
        headline: input.headline,
        matchReason: '基于双方公开方向与授权展示',
        purpose: 'connection_invitation',
        status: input.status,
        selectedFields: input.selectedFields,
        expiresInDays: input.expiresInDays,
        privacyNotice: '撤销授权后会阻断后续新读取；已送达副本不可收回。',
        providerMode: 'mock',
      };
      return {
        providerMode: 'mock',
        summary: `当前与“${input.displayName}”的连接状态为：${input.status}。`,
        data: {
          targetUserId: input.targetUserId,
          purpose: 'connection_invitation',
          status: input.status,
        },
        widgets: [widget],
      };
    },
  };

  return {
    id: 'aven.social',
    name: 'AVEN 社交连接',
    providerName: 'AVEN 内置社交内核',
    description: '按需在对话内唤起“认识一下”连接预览与双方状态卡，严格遵循用途分离与确认发送。',
    version: '1.0.0',
    category: 'social',
    authType: 'none',
    allowedExternalHosts: [],
    supportsLiveAdapter: false,
    readOnly: true,
    hasLiveCredentials: () => true,
    actions: [
      previewAction as PluginActionHandler<unknown, Record<string, unknown>>,
      statusAction as PluginActionHandler<unknown, Record<string, unknown>>,
    ],
  };
}

export function createAvenCalendarPlugin(): PluginConnector {
  const action: PluginActionHandler<
    z.infer<typeof CalendarPluginInputSchema>,
    z.infer<typeof CalendarPluginOutputSchema>
  > = {
    name: 'coordinate_schedule',
    title: '会话内日程协调卡片',
    description: '从自然语言提取会议时长/窗口约束，生成候选时段小组件（不修改外部日历）。',
    inputSchema: CalendarPluginInputSchema,
    outputSchema: CalendarPluginOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeCalendar],
    widgetKinds: ['schedule_candidates_card'],
    timeoutMs: 4000,
    maxRetries: 0,
    idempotent: true,
    execute: async (input, context) => {
      const refNow = input.referenceNow ?? new Date().toISOString();
      const parsed = parseDeterministicEventConstraints(
        input.prompt,
        refNow,
        input.defaultTimezone,
      );

      const resolvedTimezone = parsed.timezone ?? input.defaultTimezone;
      const resolvedTitle = parsed.title ?? '日程协调候选';

      const prompts: string[] = [];
      if (!parsed.windowStart || !parsed.windowEnd) {
        prompts.push('请补充协调日期范围（例如“明天”或“下周二”）。');
      }
      if (!parsed.durationMinutes) {
        prompts.push('请补充预计时长（例如 30 分钟或 1 小时）。');
      }

      const candidates =
        prompts.length === 0 && parsed.windowStart && parsed.durationMinutes
          ? [
              {
                startAt: parsed.windowStart,
                endAt: new Date(
                  Date.parse(parsed.windowStart) + parsed.durationMinutes * 60_000,
                ).toISOString(),
                score: 0.92,
                reason: `按 ${resolvedTimezone} 提取约束生成的快速候选时段（智能推荐）`,
              },
            ]
          : [];

      const status = prompts.length > 0 ? 'needs_clarification' : 'candidates_ready';
      const widget: ScheduleCandidatesWidget = {
        widgetId: `${context.widgetIdPrefix}-schedule`,
        kind: 'schedule_candidates_card',
        pluginId: 'aven.calendar',
        title: resolvedTitle,
        status,
        timezone: resolvedTimezone,
        providerMode: 'mock',
        clarificationPrompts: prompts,
        candidates,
        externalCalendarsModified: false,
      };

      return {
        providerMode: 'mock',
        summary:
          status === 'needs_clarification'
            ? '日程约束尚不完整，请补充后即可求交候选时间。'
            : `已提取 ${parsed.durationMinutes} 分钟协调需求，生成 ${candidates.length} 个候选时段。`,
        data: {
          status,
          timezone: resolvedTimezone,
          candidateCount: candidates.length,
        },
        widgets: [widget],
      };
    },
  };

  return {
    id: 'aven.calendar',
    name: 'AVEN 日程协调',
    providerName: 'AVEN 确定性时间协调引擎',
    description: '把自然语言约见需求转为会话内日程协调卡片，绝不擅自写入外部日历。',
    version: '1.0.0',
    category: 'calendar',
    authType: 'none',
    allowedExternalHosts: [],
    supportsLiveAdapter: false,
    readOnly: true,
    hasLiveCredentials: () => true,
    actions: [action as PluginActionHandler<unknown, Record<string, unknown>>],
  };
}

export function createAvenWeatherPlugin(): PluginConnector {
  const action: PluginActionHandler<
    z.infer<typeof WeatherForecastInputSchema>,
    z.infer<typeof WeatherForecastOutputSchema>
  > = {
    name: 'get_forecast',
    title: '城市天气与出行建议卡',
    description: '查询目标城市天气摘要与线下见面/通勤建议，适合搭配高德地图和约见卡片使用。',
    inputSchema: WeatherForecastInputSchema,
    outputSchema: WeatherForecastOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginReadCatalog],
    widgetKinds: ['weather_travel_card'],
    timeoutMs: 3000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const city = input.city.trim();
      const condition = city.includes('上海') || city.includes('深圳') ? '多云有微风' : '晴间多云';
      const tempMinC = city.includes('深圳') ? 19 : city.includes('上海') ? 13 : 6;
      const tempMaxC = city.includes('深圳') ? 26 : city.includes('上海') ? 20 : 15;
      const commuteAdvice = condition.includes('风')
        ? '早晚温差较明显，线下约见建议携带轻薄外套。'
        : '天气舒适能见度好，适合地铁步行或骑行前往约定地点。';

      const widget: WeatherTravelWidget = {
        widgetId: `${context.widgetIdPrefix}-weather`,
        kind: 'weather_travel_card',
        pluginId: 'aven.weather',
        title: `${city} · ${input.dateLabel}出行天气`,
        city,
        dateLabel: input.dateLabel,
        condition,
        tempMinC,
        tempMaxC,
        commuteAdvice,
        providerMode: 'mock',
      };

      return {
        providerMode: 'mock',
        summary: `${city}${input.dateLabel}预计${condition}（${tempMinC}~${tempMaxC}°C）。`,
        data: {
          city,
          dateLabel: input.dateLabel,
          condition,
          tempMinC,
          tempMaxC,
        },
        widgets: [widget],
      };
    },
  };

  return {
    id: 'aven.weather',
    name: '城市天气与出行',
    providerName: 'AVEN 气象决策助手',
    description: '提供轻量出行天气卡片，配合高德地图与日程卡片辅助线下约见决策。',
    version: '1.0.0',
    category: 'lifestyle',
    authType: 'none',
    allowedExternalHosts: [],
    supportsLiveAdapter: false,
    readOnly: true,
    hasLiveCredentials: () => true,
    actions: [action as PluginActionHandler<unknown, Record<string, unknown>>],
  };
}
