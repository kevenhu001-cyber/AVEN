import { z } from 'zod';
import {
  EmailThreadSummarySchema,
  TOOL_PERMISSIONS,
  type EmailComposePreviewWidget,
  type EmailThreadListWidget,
  type EmailThreadSummary,
} from '@aven/contracts';
import type { PluginActionHandler, PluginConnector } from './registry.js';

export const MailSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    unreadOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const MailSearchOutputSchema = z
  .object({
    mailboxProvider: z.enum(['gmail', 'qqmail']),
    query: z.string().trim().min(1).max(160),
    total: z.number().int().min(0).max(50),
    threads: z.array(EmailThreadSummarySchema).max(10),
  })
  .strict();

export const MailDraftInputSchema = z
  .object({
    to: z.array(z.string().trim().email().max(160)).min(1).max(10),
    cc: z.array(z.string().trim().email().max(160)).max(10).default([]),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
  })
  .strict();

export const MailSendInputSchema = z
  .object({
    draftId: z.string().trim().min(1).max(120),
    to: z.array(z.string().trim().email().max(160)).min(1).max(10),
    cc: z.array(z.string().trim().email().max(160)).max(10).default([]),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
    confirmed: z.literal(true),
  })
  .strict();

export const MailComposeOutputSchema = z
  .object({
    mailboxProvider: z.enum(['gmail', 'qqmail']),
    draftId: z.string().trim().min(1).max(120),
    status: z.enum(['draft_preview', 'sent']),
    recipientCount: z.number().int().min(1).max(20),
  })
  .strict();

export type MailSearchInput = z.infer<typeof MailSearchInputSchema>;
export type MailDraftInput = z.infer<typeof MailDraftInputSchema>;
export type MailSendInput = z.infer<typeof MailSendInputSchema>;

export type MailboxLiveAdapter = {
  searchThreads?: (
    input: MailSearchInput,
    signal?: AbortSignal,
  ) => Promise<readonly EmailThreadSummary[]>;
  sendEmail?: (input: MailSendInput, signal?: AbortSignal) => Promise<{ messageId: string }>;
};

export type MailboxPluginOptions = {
  hasCredentials?: boolean;
  liveAdapter?: MailboxLiveAdapter;
};

type MailboxProfile = {
  id: 'gmail.mail' | 'qqmail.mail';
  provider: 'gmail' | 'qqmail';
  name: string;
  providerName: string;
  description: string;
  authType: 'oauth2' | 'api_key';
  allowedHosts: readonly string[];
  mockThreads: readonly EmailThreadSummary[];
};

const GMAIL_PROFILE: MailboxProfile = {
  id: 'gmail.mail',
  provider: 'gmail',
  name: 'Gmail 邮箱',
  providerName: 'Google Workspace / Gmail',
  description: '检索 Gmail 邮件摘要并生成写信草稿预览；正式发送必须经过用户确认。',
  authType: 'oauth2',
  allowedHosts: ['mail.google.com', 'gmail.googleapis.com'],
  mockThreads: [
    {
      threadId: 'gm-thread-101',
      fromLabel: 'Prof. Lin <lin@cs.tsinghua.edu.cn>',
      subject: 'Re: 机器人实验室周会与实验排期确认',
      snippet: '本周五下午 3 点在信息楼 402 室讨论具身导航实验，请提前带上最新评测结果。',
      receivedAt: '2026-11-12T08:15:00.000Z',
      unread: true,
      hasAttachments: true,
    },
    {
      threadId: 'gm-thread-102',
      fromLabel: 'GitHub <notifications@github.com>',
      subject: '[aven] Pull request review requested: plugin architecture',
      snippet: 'You were requested to review the extensible widget contracts update.',
      receivedAt: '2026-11-12T06:40:00.000Z',
      unread: false,
      hasAttachments: false,
    },
  ],
};

const QQMAIL_PROFILE: MailboxProfile = {
  id: 'qqmail.mail',
  provider: 'qqmail',
  name: 'QQ 邮箱',
  providerName: '腾讯 QQ 邮箱（IMAP/SMTP）',
  description: '检索 QQ 邮箱往来摘要与起草回复，正文脱敏展示且发送前强制二次确认。',
  authType: 'api_key',
  allowedHosts: ['mail.qq.com', 'wx.mail.qq.com'],
  mockThreads: [
    {
      threadId: 'qq-thread-201',
      fromLabel: '园区物业中心 <service@park.example.cn>',
      subject: '关于周五晚间快递柜与访客通行调整通知',
      snippet: '本周五 18:00 后访客需提前线上报备，东门智能快递柜正常运行。',
      receivedAt: '2026-11-12T09:10:00.000Z',
      unread: true,
      hasAttachments: false,
    },
    {
      threadId: 'qq-thread-202',
      fromLabel: '电子发票平台 <invoice@billing.example.cn>',
      subject: '您有一张新的电子普通发票待查收',
      snippet: '订单金额 489.00 元，采购品目：计算机外设设备，请注意及时归档。',
      receivedAt: '2026-11-11T14:20:00.000Z',
      unread: false,
      hasAttachments: true,
    },
  ],
};

function filterMockThreads(profile: MailboxProfile, input: MailSearchInput): EmailThreadSummary[] {
  const q = input.query.trim().toLowerCase();
  const matched = profile.mockThreads.filter((item) => {
    if (input.unreadOnly && !item.unread) return false;
    return (
      item.fromLabel.toLowerCase().includes(q) ||
      item.subject.toLowerCase().includes(q) ||
      item.snippet.toLowerCase().includes(q)
    );
  });
  if (matched.length > 0) {
    return matched.slice(0, input.limit);
  }
  if (input.unreadOnly) {
    return profile.mockThreads.filter((t) => t.unread).slice(0, input.limit);
  }
  return [
    {
      threadId: `${profile.provider}-mock-search-1`,
      fromLabel: `${profile.name}通知中心 <notice@example.com>`,
      subject: `与“${input.query.trim()}”相关的邮件摘要`,
      snippet: '该记录由邮箱接入器安全沙箱提供，保护您的个人凭据与邮件隐私安全。',
      receivedAt: new Date().toISOString(),
      unread: true,
      hasAttachments: false,
    },
  ];
}

function createMailboxConnector(
  profile: MailboxProfile,
  options: MailboxPluginOptions = {},
): PluginConnector {
  const hasLive = Boolean(options.hasCredentials && options.liveAdapter);

  const searchThreadsAction: PluginActionHandler<
    MailSearchInput,
    z.infer<typeof MailSearchOutputSchema>
  > = {
    name: 'search_threads',
    title: '检索邮件摘要',
    description: `按关键词与未读状态检索 ${profile.name} 摘要列表，返回脱敏列表小组件。`,
    inputSchema: MailSearchInputSchema,
    outputSchema: MailSearchOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginReadMail],
    widgetKinds: ['email_thread_list_card'],
    timeoutMs: 6000,
    maxRetries: 1,
    idempotent: true,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveAdapter?.searchThreads);
      const rawThreads = useLive
        ? await options.liveAdapter!.searchThreads!(input, context.signal)
        : filterMockThreads(profile, input);
      const threads = rawThreads.slice(0, input.limit);
      const providerMode = useLive ? 'live' : 'mock';

      const widget: EmailThreadListWidget = {
        widgetId: `${context.widgetIdPrefix}-threads`,
        kind: 'email_thread_list_card',
        pluginId: profile.id,
        title: `${profile.name}：${input.query}`,
        mailboxProvider: profile.provider,
        query: input.query,
        providerMode,
        threads,
      };

      return {
        providerMode,
        summary: `在 ${profile.name} 中找到 ${threads.length} 封匹配邮件摘要。`,
        data: {
          mailboxProvider: profile.provider,
          query: input.query,
          total: threads.length,
          threads,
        },
        widgets: [widget],
      };
    },
  };

  const draftEmailAction: PluginActionHandler<
    MailDraftInput,
    z.infer<typeof MailComposeOutputSchema>
  > = {
    name: 'draft_email',
    title: '起草邮件预览',
    description: '生成发信预览卡片，需经用户明确确认后才允许触发发送。',
    inputSchema: MailDraftInputSchema,
    outputSchema: MailComposeOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginWriteMailDraft],
    widgetKinds: ['email_compose_preview_card'],
    timeoutMs: 4000,
    maxRetries: 0,
    idempotent: true,
    execute: async (input, context) => {
      const draftId = `draft-${profile.provider}-${context.requestId.slice(0, 8)}`;
      const providerMode = context.allowLive && hasLive ? 'live' : 'mock';
      const widget: EmailComposePreviewWidget = {
        widgetId: `${context.widgetIdPrefix}-draft`,
        kind: 'email_compose_preview_card',
        pluginId: profile.id,
        title: `${profile.name} · 写信草稿预览`,
        draftId,
        mailboxProvider: profile.provider,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        bodyPreview: input.body.slice(0, 1000),
        status: 'draft_preview',
        requiresUserConfirmation: true,
        providerMode,
      };

      return {
        providerMode,
        summary: `已生成发往 ${input.to.join(', ')} 的邮件草稿预览，请核对后确认发送。`,
        data: {
          mailboxProvider: profile.provider,
          draftId,
          status: 'draft_preview',
          recipientCount: input.to.length + input.cc.length,
        },
        widgets: [widget],
      };
    },
  };

  const sendEmailAction: PluginActionHandler<
    MailSendInput,
    z.infer<typeof MailComposeOutputSchema>
  > = {
    name: 'send_email',
    title: '确认发送邮件',
    description: '在用户明确确认草稿（confirmed=true）后执行邮件发送。',
    inputSchema: MailSendInputSchema,
    outputSchema: MailComposeOutputSchema,
    requiredPermissions: [TOOL_PERMISSIONS.pluginSendMail],
    widgetKinds: ['email_compose_preview_card'],
    timeoutMs: 8000,
    maxRetries: 0,
    idempotent: false,
    execute: async (input, context) => {
      const useLive = context.allowLive && hasLive && Boolean(options.liveAdapter?.sendEmail);
      if (useLive) {
        await options.liveAdapter!.sendEmail!(input, context.signal);
      }
      const providerMode = useLive ? 'live' : 'mock';
      const widget: EmailComposePreviewWidget = {
        widgetId: `${context.widgetIdPrefix}-sent`,
        kind: 'email_compose_preview_card',
        pluginId: profile.id,
        title: `${profile.name} · 邮件已${providerMode === 'live' ? '发送' : '安全发送预览'}`,
        draftId: input.draftId,
        mailboxProvider: profile.provider,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        bodyPreview: input.body.slice(0, 1000),
        status: 'sent',
        requiresUserConfirmation: false,
        providerMode,
      };

      return {
        providerMode,
        summary:
          providerMode === 'live'
            ? `已通过 ${profile.name} 发送邮件《${input.subject}》。`
            : `已按用户确认完成 ${profile.name} 发送预览《${input.subject}》（沙箱安全保护）。`,
        data: {
          mailboxProvider: profile.provider,
          draftId: input.draftId,
          status: 'sent',
          recipientCount: input.to.length + input.cc.length,
        },
        widgets: [widget],
      };
    },
  };

  return {
    id: profile.id,
    name: profile.name,
    providerName: profile.providerName,
    description: profile.description,
    version: '1.0.0',
    category: 'mail',
    authType: profile.authType,
    allowedExternalHosts: [...profile.allowedHosts],
    supportsLiveAdapter: true,
    readOnly: false,
    hasLiveCredentials: () => hasLive,
    actions: [
      searchThreadsAction as PluginActionHandler<unknown, Record<string, unknown>>,
      draftEmailAction as PluginActionHandler<unknown, Record<string, unknown>>,
      sendEmailAction as PluginActionHandler<unknown, Record<string, unknown>>,
    ],
  };
}

export function createGmailPlugin(options: MailboxPluginOptions = {}): PluginConnector {
  return createMailboxConnector(GMAIL_PROFILE, options);
}

export function createQqMailPlugin(options: MailboxPluginOptions = {}): PluginConnector {
  return createMailboxConnector(QQMAIL_PROFILE, options);
}
