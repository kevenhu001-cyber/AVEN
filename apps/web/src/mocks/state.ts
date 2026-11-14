/**
 * In-memory state for the local mock API layer. It exists so the personal Web UI can be
 * developed, demoed and screenshotted without Docker/Postgres or the real API/Worker.
 * It implements no business rules, no persistence and no authorization: everything is
 * seeded, labelled as simulated and lost on restart. Enabled only when AVEN_WEB_MOCK=1.
 */
import type {
  ConversationMessage,
  ConversationSummary,
  Notification,
  UserAIProviderMetadata,
} from '@aven/contracts';

export const MOCK_USER = {
  id: 'e521efc6-60c7-4725-aabe-9c31cff1bab9',
  displayName: '本地模拟',
  email: 'mock@local.test',
  emailVerified: true,
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
} as const;

export const MOCK_CSRF_TOKEN = 'mock-csrf-token';

const T0 = '2026-11-13T18:29:00.000Z';
const T1 = '2026-11-13T18:30:00.000Z';
const T2 = '2026-11-12T10:00:00.000Z';
const T3 = '2026-11-12T10:01:00.000Z';

export type MockMessage = ConversationMessage;

export type MockConversation = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: MockMessage[];
};

export type MockRun = {
  id: string;
  conversationId: string;
  input: string;
  status: 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  cancelRequested: boolean;
  provider: string;
  model: string;
  createdAt: string;
};

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  const tail = String(seq).padStart(12, '0').slice(-12);
  return `aaaa0000-0000-4000-8000-${prefix}${tail}`.slice(0, 36);
}

export function nextId(prefix = '0'): string {
  return id(prefix);
}

export function nowIso(): string {
  return new Date().toISOString();
}

const seedConversation = (
  convId: string,
  createdAt: string,
  updatedAt: string,
  messages: Array<{ body: string; derived: boolean; at: string }>,
): MockConversation => ({
  id: convId,
  createdAt,
  updatedAt,
  messages: messages.map((message, index) => ({
    id: nextId(String(index)),
    body: message.body,
    contentType: 'text',
    derivedFromRunId: message.derived ? '11111111-1111-4111-8111-111111111111' : null,
    createdAt: message.at,
    editedAt: null,
  })),
});

const conversations = new Map<string, MockConversation>();
const runs = new Map<string, MockRun>();

const conversationIds = [
  '33333333-3333-4333-8333-333333333301',
  '33333333-3333-4333-8333-333333333302',
  '33333333-3333-4333-8333-333333333303',
];

function seedConversations(): void {
  conversations.set(
    conversationIds[0]!,
    seedConversation(conversationIds[0]!, T0, T1, [
      { body: '昨晚 CI 挂了什么？', derived: false, at: T0 },
      {
        body: '【模拟回复】1348 个前端单元测试里只挂了 1 个。`rayleigh.test.mjs` 仍要求拒绝 `wavelength: "550"`。要我改这个测试并开一个 PR 吗？',
        derived: true,
        at: T1,
      },
    ]),
  );
  conversations.set(
    conversationIds[1]!,
    seedConversation(conversationIds[1]!, T2, T3, [
      { body: '帮我连接 Gmail', derived: false, at: T2 },
      {
        body: '【模拟回复】可以在「连接应用」里完成 Gmail 的真实授权；本页只演示入口与卡片样式。',
        derived: true,
        at: T3,
      },
    ]),
  );
  conversations.set(
    conversationIds[2]!,
    seedConversation(conversationIds[2]!, '2026-11-11T09:00:00.000Z', '2026-11-11T09:01:00.000Z', [
      {
        body: '具身智能最近有什么值得关注的趋势？',
        derived: false,
        at: '2026-11-11T09:00:00.000Z',
      },
      {
        body: '【模拟回复】这是一个本地模拟回答：用于核对 Markdown、代码块与排版样式，不来自真实模型。',
        derived: true,
        at: '2026-11-11T09:01:00.000Z',
      },
    ]),
  );
}

export function listConversations(): ConversationSummary[] {
  return [...conversations.values()]
    .map((conversation) => ({
      id: conversation.id,
      title:
        conversation.messages
          .find((message) => message.derivedFromRunId === null)
          ?.body.slice(0, 200) ?? '（无标题对话）',
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getConversation(id: string): MockConversation | undefined {
  return conversations.get(id);
}

export function listConversationMessages(id: string): MockMessage[] {
  return conversations.get(id)?.messages ?? [];
}

export function ensureConversation(id: string | undefined): MockConversation {
  if (id && conversations.has(id)) return conversations.get(id)!;
  const conversation: MockConversation = {
    id: id ?? nextId('1'),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
  };
  conversations.set(conversation.id, conversation);
  return conversation;
}

export function appendMessage(
  conversation: MockConversation,
  body: string,
  derivedFromRunId: string | null,
): MockMessage {
  const message: MockMessage = {
    id: nextId('2'),
    body,
    contentType: 'text',
    derivedFromRunId,
    createdAt: nowIso(),
    editedAt: null,
  };
  conversation.messages.push(message);
  conversation.updatedAt = message.createdAt;
  return message;
}

export function createRun(conversationId: string, input: string): MockRun {
  const run: MockRun = {
    id: nextId('3'),
    conversationId,
    input,
    status: 'queued',
    cancelRequested: false,
    provider: 'mock',
    model: 'mock-reply',
    createdAt: nowIso(),
  };
  runs.set(run.id, run);
  return run;
}

export function getRun(id: string): MockRun | undefined {
  return runs.get(id);
}

export function requestCancel(runId: string): MockRun | undefined {
  const run = runs.get(runId);
  if (!run) return undefined;
  run.cancelRequested = true;
  if (run.status === 'queued' || run.status === 'running') run.status = 'cancelling';
  return run;
}

export function finishRun(run: MockRun, status: 'completed' | 'cancelled' | 'failed'): void {
  run.status = status;
}

export function activeRuns(): MockRun[] {
  return [...runs.values()].filter(
    (run) => run.status === 'queued' || run.status === 'running' || run.status === 'cancelling',
  );
}

/* ---------- notifications ---------- */

export type MockNotification = Notification & { internalId: string };

let notifications: MockNotification[] = [];
let preferences = {
  connectionInvitations: true,
  connectionUpdates: true,
  eventInvitations: true,
  eventUpdates: true,
  version: 3,
};

function seedNotifications(): void {
  notifications = [
    {
      internalId: nextId('4'),
      id: nextId('4'),
      kind: 'accepted',
      target: { type: 'event', id: '66666666-6666-4666-8666-666666666601' },
      createdAt: '2026-11-13T12:00:00.000Z',
      readAt: null,
    },
    {
      internalId: nextId('4'),
      id: nextId('4'),
      kind: 'confirmed',
      target: { type: 'event', id: '66666666-6666-4666-8666-666666666602' },
      createdAt: '2026-11-12T15:30:00.000Z',
      readAt: '2026-11-12T16:00:00.000Z',
    },
    {
      internalId: nextId('4'),
      id: nextId('4'),
      kind: 'sent',
      target: { type: 'connection_invitation', id: '66666666-6666-4666-8666-666666666603' },
      createdAt: '2026-11-11T09:00:00.000Z',
      readAt: '2026-11-11T10:00:00.000Z',
    },
  ];
}

export function listNotifications(): {
  data: Notification[];
  unreadCount: number;
  nextCursor: null;
} {
  return {
    data: notifications.map(({ internalId: _internalId, ...notification }) => notification),
    unreadCount: notifications.filter((notification) => notification.readAt === null).length,
    nextCursor: null,
  };
}

export function readNotification(id: string): Notification | undefined {
  const notification = notifications.find((item) => item.id === id);
  if (!notification || notification.readAt) return notification;
  notification.readAt = nowIso();
  return notification;
}

export function getPreferences() {
  return { ...preferences };
}

export function updatePreferences(next: typeof preferences): typeof preferences {
  preferences = { ...next, version: next.version + 1 };
  return { ...preferences };
}

/* ---------- memories ---------- */

export type MockMemory = {
  id: string;
  kind: string;
  title: string;
  content: string;
  structuredValue: Record<string, unknown> | null;
  sensitivity: 'low' | 'normal' | 'high';
  status: 'pending_confirmation' | 'confirmed' | 'rejected' | 'expired';
  version: number;
  validFrom: string | null;
  validUntil: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  policy: {
    displayAudience: 'owner' | 'campus' | 'public';
    discoverable: boolean;
    allowedUses: Array<'self_ai' | 'matching' | 'sharing'>;
    campusId: string | null;
    version: number;
  };
  sourceCount: number;
};

let memories: MockMemory[] = [];

function seedMemories(): void {
  memories = [
    {
      id: nextId('5'),
      kind: 'project',
      title: 'AVEN 个人 Web 重构',
      content: '正在推进个人 Web 的 Halo 主题与会话历史能力。',
      structuredValue: null,
      sensitivity: 'normal',
      status: 'confirmed',
      version: 1,
      validFrom: null,
      validUntil: null,
      confirmedAt: '2026-11-10T10:00:00.000Z',
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:00:00.000Z',
      policy: {
        displayAudience: 'owner',
        discoverable: false,
        allowedUses: ['self_ai'],
        campusId: null,
        version: 1,
      },
      sourceCount: 0,
    },
    {
      id: nextId('5'),
      kind: 'interest',
      title: '具身智能',
      content: '对具身智能与机器人学习方向保持关注。',
      structuredValue: null,
      sensitivity: 'normal',
      status: 'confirmed',
      version: 1,
      validFrom: null,
      validUntil: null,
      confirmedAt: '2026-11-09T10:00:00.000Z',
      createdAt: '2026-11-09T10:00:00.000Z',
      updatedAt: '2026-11-09T10:00:00.000Z',
      policy: {
        displayAudience: 'owner',
        discoverable: false,
        allowedUses: ['self_ai'],
        campusId: null,
        version: 1,
      },
      sourceCount: 0,
    },
    {
      id: nextId('5'),
      kind: 'skill',
      title: '候选：TypeScript 工程实践',
      content: '【模拟数据】候选记忆示例，可在复核页确认或拒绝。',
      structuredValue: null,
      sensitivity: 'normal',
      status: 'pending_confirmation',
      version: 1,
      validFrom: null,
      validUntil: null,
      confirmedAt: null,
      createdAt: '2026-11-13T08:00:00.000Z',
      updatedAt: '2026-11-13T08:00:00.000Z',
      policy: {
        displayAudience: 'owner',
        discoverable: false,
        allowedUses: [],
        campusId: null,
        version: 0,
      },
      sourceCount: 0,
    },
  ];
}

export function listMemories(): MockMemory[] {
  return memories;
}

export function createMemory(input: Partial<MockMemory>): MockMemory {
  const memory: MockMemory = {
    id: nextId('5'),
    kind: input.kind ?? 'project',
    title: input.title ?? '（未命名记忆）',
    content: input.content ?? '',
    structuredValue: input.structuredValue ?? null,
    sensitivity: input.sensitivity ?? 'normal',
    status: 'confirmed',
    version: 1,
    validFrom: null,
    validUntil: null,
    confirmedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    policy: input.policy ?? {
      displayAudience: 'owner',
      discoverable: false,
      allowedUses: ['self_ai'],
      campusId: null,
      version: 1,
    },
    sourceCount: 0,
  };
  memories = [memory, ...memories];
  return memory;
}

export function updateMemory(
  id: string,
  expectedVersion: number,
  patch: Partial<MockMemory>,
): MockMemory | undefined {
  const memory = memories.find((item) => item.id === id);
  if (!memory || memory.version !== expectedVersion) return undefined;
  Object.assign(memory, patch, { version: memory.version + 1, updatedAt: nowIso() });
  return memory;
}

export function deleteMemory(id: string, expectedVersion: number): boolean {
  const memory = memories.find((item) => item.id === id);
  if (!memory || memory.version !== expectedVersion) return false;
  memories = memories.filter((item) => item.id !== id);
  return true;
}

/* ---------- provider / catalog / connectors ---------- */

let provider: { baseUrl: string; model: string } | null = null;
let providerVersion = 0;
let providerUpdatedAt = nowIso();

export function getProvider(): UserAIProviderMetadata | null {
  if (!provider) return null;
  return {
    baseUrl: provider.baseUrl,
    model: provider.model,
    version: providerVersion,
    updatedAt: providerUpdatedAt,
  };
}

export function saveProvider(next: { baseUrl: string; model: string }): UserAIProviderMetadata {
  provider = { baseUrl: next.baseUrl, model: next.model };
  providerVersion += 1;
  providerUpdatedAt = nowIso();
  return getProvider()!;
}

export function deleteProvider(expectedVersion: number): boolean {
  if (!provider) return true;
  if (expectedVersion !== providerVersion) return false;
  provider = null;
  return true;
}

export type MockCatalogPlugin = {
  id: string;
  name: string;
  providerName: string;
  description: string;
  version: string;
  category: string;
  authType: string;
  credentialStatus: 'configured' | 'missing_credentials' | 'mock_only';
  allowedExternalHosts: string[];
  supportsLiveAdapter: boolean;
  readOnly: boolean;
  actions: Array<{
    name: string;
    title: string;
    description: string;
    requiredPermissions: string[];
    widgetKinds: string[];
    idempotent: boolean;
    timeoutMs: number;
    maxRetries: number;
    inputJsonSchema: Record<string, unknown>;
  }>;
};

let catalog: MockCatalogPlugin[] = [];

function seedCatalog(): void {
  const action = (
    name: string,
    title: string,
    permission: string,
    required: string[] = [],
  ): MockCatalogPlugin['actions'][number] => ({
    name,
    title,
    description: `${title}（模拟动作）`,
    requiredPermissions: [permission],
    widgetKinds: ['action_preview_card'],
    idempotent: true,
    timeoutMs: 5000,
    maxRetries: 1,
    inputJsonSchema: { type: 'object', properties: { query: { type: 'string' } }, required },
  });
  catalog = [
    {
      id: 'gmail.mail',
      name: 'Gmail',
      providerName: 'Google',
      description: '搜索、读取、撰写和管理邮件（模拟目录项）。',
      version: '1.0.0',
      category: 'mail',
      authType: 'oauth2',
      credentialStatus: 'configured',
      allowedExternalHosts: [],
      supportsLiveAdapter: true,
      readOnly: false,
      actions: [action('list_messages', '读取邮件', 'plugin:read:mail')],
    },
    {
      id: 'googlecalendar.calendar',
      name: 'Google Calendar',
      providerName: 'Google',
      description: '检索日程并安排会议（模拟目录项）。',
      version: '1.0.0',
      category: 'calendar',
      authType: 'oauth2',
      credentialStatus: 'configured',
      allowedExternalHosts: [],
      supportsLiveAdapter: true,
      readOnly: false,
      actions: [action('list_events', '读取日程', 'plugin:read:mail')],
    },
    {
      id: 'amap.maps',
      name: '高德地图',
      providerName: '高德',
      description: '地点与地址检索（模拟目录项）。',
      version: '1.0.0',
      category: 'maps',
      authType: 'api_key',
      credentialStatus: 'missing_credentials',
      allowedExternalHosts: [],
      supportsLiveAdapter: true,
      readOnly: true,
      actions: [action('search_poi', '地点检索', 'plugin:invoke:maps', ['query'])],
    },
    {
      id: 'jd.commerce',
      name: '京东商品检索',
      providerName: '京东',
      description: '搜索商品与价格对比（模拟目录项）。',
      version: '1.0.0',
      category: 'commerce',
      authType: 'api_key',
      credentialStatus: 'mock_only',
      allowedExternalHosts: [],
      supportsLiveAdapter: false,
      readOnly: true,
      actions: [action('search_product', '商品检索', 'plugin:invoke:maps', ['query'])],
    },
    {
      id: 'aven.weather',
      name: 'AVEN 天气',
      providerName: 'AVEN',
      description: '城市天气与出行建议（模拟目录项）。',
      version: '1.0.0',
      category: 'lifestyle',
      authType: 'none',
      credentialStatus: 'configured',
      allowedExternalHosts: [],
      supportsLiveAdapter: false,
      readOnly: true,
      actions: [action('query_weather', '查询天气', 'plugin:invoke:maps', ['query'])],
    },
    {
      id: 'aven.compare',
      name: '跨平台对比',
      providerName: 'AVEN',
      description: '多来源信息对比（模拟目录项）。',
      version: '1.0.0',
      category: 'productivity',
      authType: 'none',
      credentialStatus: 'configured',
      allowedExternalHosts: [],
      supportsLiveAdapter: false,
      readOnly: true,
      actions: [action('compare', '对比检索', 'plugin:invoke:maps', ['query'])],
    },
  ];
}

export function listCatalog(): MockCatalogPlugin[] {
  return catalog;
}

export type MockConnector = { service: string; status: string };

let connectors: MockConnector[] = [];

function seedConnectors(): void {
  connectors = [
    { service: 'gmail', status: 'connected' },
    { service: 'googlecalendar', status: 'connected' },
    { service: 'googledrive', status: 'failed' },
    { service: 'github', status: 'pending' },
    { service: 'outlook', status: 'cancelled' },
  ];
}

export function listConnectors(): MockConnector[] {
  return connectors.map((connector) => ({ ...connector }));
}

export function connectConnector(service: string): void {
  const connector = connectors.find((item) => item.service === service);
  if (connector) connector.status = 'pending';
}

export function refreshConnector(service: string): boolean {
  const connector = connectors.find((item) => item.service === service);
  if (!connector) return false;
  connector.status = 'connected';
  return true;
}

export function disconnectConnector(service: string): boolean {
  const connector = connectors.find((item) => item.service === service);
  if (!connector) return false;
  connector.status = 'expired';
  return true;
}

/** Re-seed everything; called on first use so each server process starts deterministic. */
export function ensureSeeded(): void {
  if (conversations.size === 0) seedConversations();
  if (notifications.length === 0) seedNotifications();
  if (memories.length === 0) seedMemories();
  if (catalog.length === 0) seedCatalog();
  if (connectors.length === 0) seedConnectors();
}
