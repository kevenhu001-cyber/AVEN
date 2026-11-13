/**
 * Connect-apps sheet helpers. Catalog data always comes from GET /api/v1/plugins; these
 * functions only group, filter and label it. "已连接" here means a Mock authorization made in
 * this page session (ADR-017/018), never a real third-party account.
 */
export type CatalogPlugin = {
  id: string;
  name: string;
  providerName?: string;
  description: string;
  category: string;
  authType: string;
  credentialStatus: string;
  readOnly?: boolean;
  actions: { name: string; title: string }[];
};

export type CatalogSection<T> = { id: string; title: string; browsable: boolean; plugins: T[] };

export const categoryLabels: Record<string, string> = {
  mail: '邮箱',
  calendar: '日程',
  maps: '地图',
  commerce: '购物',
  lifestyle: '生活',
  social: '社交',
  productivity: '效率',
  mcp: 'MCP 插件',
};

const categoryOrder = [
  'mail',
  'calendar',
  'maps',
  'commerce',
  'lifestyle',
  'social',
  'productivity',
  'mcp',
];
const featuredCategories = ['mail', 'calendar', 'maps', 'social'];

export function matchesQuery(plugin: CatalogPlugin, query: string) {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  if (!needle) return true;
  return [
    plugin.name,
    plugin.providerName ?? '',
    plugin.description,
    categoryLabels[plugin.category] ?? plugin.category,
    ...plugin.actions.map((action) => action.title),
  ].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle));
}

/** 精选插件 (one per featured category, max 4) followed by every category; search flattens. */
export function groupCatalog<T extends CatalogPlugin>(
  plugins: T[],
  query = '',
): CatalogSection<T>[] {
  const filtered = plugins.filter((plugin) => matchesQuery(plugin, query));
  if (query.trim())
    return filtered.length
      ? [{ id: 'search', title: '搜索结果', browsable: false, plugins: filtered }]
      : [];
  const featured: T[] = [];
  for (const category of featuredCategories) {
    const first = filtered.find((plugin) => plugin.category === category);
    if (first && featured.length < 4) featured.push(first);
  }
  const rank = (category: string) => {
    const index = categoryOrder.indexOf(category);
    return index < 0 ? categoryOrder.length : index;
  };
  const categories = [...new Set(filtered.map((plugin) => plugin.category))].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
  const sections: CatalogSection<T>[] = [];
  if (featured.length)
    sections.push({ id: 'featured', title: '精选插件', browsable: true, plugins: featured });
  for (const category of categories)
    sections.push({
      id: category,
      title: categoryLabels[category] ?? category,
      browsable: true,
      plugins: filtered.filter((plugin) => plugin.category === category),
    });
  return sections;
}

export type ConnectButton = {
  label: '授权' | '连接' | '已连接';
  tone: 'authorize' | 'neutral' | 'done';
  disabled: boolean;
};

export function connectButton(
  plugin: CatalogPlugin,
  connected: ReadonlySet<string>,
): ConnectButton {
  if (connected.has(plugin.id)) return { label: '已连接', tone: 'done', disabled: true };
  if (plugin.authType === 'oauth2') return { label: '授权', tone: 'authorize', disabled: false };
  return { label: '连接', tone: 'neutral', disabled: false };
}

export function credentialLabel(status: string) {
  if (status === 'mock_only') return '仅 Mock';
  if (status === 'configured') return '已配置';
  return '缺少凭据';
}

/**
 * Detect a "帮我连接 Gmail" style request in the user's own message so the page can place a
 * Mock authorization card under it. This is a local UI rule, not model output.
 */
export function detectConnectorIntent<T extends CatalogPlugin>(
  text: string,
  plugins: T[],
): T | null {
  const lower = text.toLocaleLowerCase('zh-CN');
  if (!/(连接|连上|接入|授权|绑定|添加|connect|authorize)/i.test(lower)) return null;
  const aliases = (plugin: T) => {
    const prefix = plugin.id.split('.')[0] ?? '';
    const names = [plugin.name, plugin.providerName ?? '', prefix === 'aven' ? '' : prefix];
    if (plugin.id.startsWith('gmail')) names.push('gmail', '谷歌邮箱');
    if (plugin.id.startsWith('qqmail')) names.push('qq邮箱', 'qq 邮箱');
    if (plugin.id.startsWith('amap')) names.push('高德');
    if (plugin.id.startsWith('jd')) names.push('京东');
    if (plugin.id.startsWith('taobao.')) names.push('淘宝');
    if (plugin.id.startsWith('meituan')) names.push('美团');
    return names
      .map((name) => name.trim().toLocaleLowerCase('zh-CN'))
      .filter((name) => name.length >= 2);
  };
  let best: { plugin: T; length: number } | null = null;
  for (const plugin of plugins)
    for (const alias of aliases(plugin))
      if (lower.includes(alias) && (!best || alias.length > best.length))
        best = { plugin, length: alias.length };
  return best?.plugin ?? null;
}

/** Mock authorization card state machine: 授权 → 确认范围 → 授权中 → 已连接 (Mock) → 断开. */
export type AuthState = 'idle' | 'confirming' | 'authorizing' | 'connected';
export type AuthEvent = 'request' | 'cancel' | 'confirm' | 'settled' | 'disconnect';

export function authTransition(state: AuthState, event: AuthEvent): AuthState {
  switch (state) {
    case 'idle':
      return event === 'request' ? 'confirming' : state;
    case 'confirming':
      if (event === 'cancel') return 'idle';
      if (event === 'confirm') return 'authorizing';
      return state;
    case 'authorizing':
      return event === 'settled' ? 'connected' : state;
    case 'connected':
      return event === 'disconnect' ? 'idle' : state;
  }
}

export function authStatusText(state: AuthState) {
  return {
    idle: '尚未添加',
    confirming: '等待你确认授权范围',
    authorizing: '正在模拟授权…',
    connected: 'Mock 授权 · 本页有效',
  }[state];
}

/** Master notification switch over the four server-side preferences. */
export type NotificationFlags = {
  connectionInvitations: boolean;
  connectionUpdates: boolean;
  eventInvitations: boolean;
  eventUpdates: boolean;
};

export function masterNotificationState(flags: NotificationFlags): 'on' | 'off' | 'mixed' {
  const values = [
    flags.connectionInvitations,
    flags.connectionUpdates,
    flags.eventInvitations,
    flags.eventUpdates,
  ];
  if (values.every(Boolean)) return 'on';
  if (values.every((value) => !value)) return 'off';
  return 'mixed';
}

export function applyMasterNotification(enabled: boolean): NotificationFlags {
  return {
    connectionInvitations: enabled,
    connectionUpdates: enabled,
    eventInvitations: enabled,
    eventUpdates: enabled,
  };
}
