import { describe, expect, it } from 'vitest';
import {
  appsRowAction,
  applyMasterNotification,
  composerAction,
  connectButton,
  connectedServiceCount,
  credentialLabel,
  detectConnectorIntent,
  groupCatalog,
  masterNotificationState,
  type CatalogPlugin,
} from './catalog';
import { currentScreen, initialStack, popScreen, pushScreen, screenPosition } from './navigation';
import {
  composeModePrefix,
  countHighlights,
  countMatches,
  highlightSegments,
  splitInlineCode,
  stepMatch,
  templateFromConversation,
} from './text';
import { buildTimeline, formatChatTimestamp, isNearBottom, recallVisible } from './timeline';

const plugin = (
  id: string,
  category: string,
  extra: Partial<CatalogPlugin> = {},
): CatalogPlugin => ({
  id,
  name: id,
  description: `${id} description`,
  category,
  authType: 'none',
  credentialStatus: 'mock_only',
  actions: [{ name: 'run', title: '运行' }],
  ...extra,
});

const catalog = [
  plugin('amap.maps', 'maps', {
    name: '高德地图',
    authType: 'api_key',
    credentialStatus: 'missing_credentials',
  }),
  plugin('gmail.mail', 'mail', { name: 'Gmail', providerName: 'Google', authType: 'oauth2' }),
  plugin('qqmail.mail', 'mail', { name: 'QQ 邮箱', authType: 'oauth2' }),
  plugin('aven.calendar', 'calendar', { name: 'AVEN 日程协调' }),
  plugin('aven.social', 'social', { name: 'AVEN 社交连接' }),
  plugin('jd.commerce', 'commerce', { name: '京东商品检索', authType: 'api_key' }),
];

describe('halo navigation stack', () => {
  it('pushes, pops and never duplicates screens', () => {
    const chat = pushScreen(initialStack, 'chat');
    expect(chat).toEqual({ stack: ['home', 'chat'], direction: 'forward' });
    const profile = pushScreen(chat, 'profile');
    expect(currentScreen(profile)).toBe('profile');
    expect(pushScreen(profile, 'profile')).toBe(profile);
    expect(pushScreen(profile, 'chat')).toEqual({ stack: ['home', 'chat'], direction: 'back' });
    expect(popScreen(profile)).toEqual({ stack: ['home', 'chat'], direction: 'back' });
    expect(popScreen(initialStack)).toBe(initialStack);
  });
  it('places screens for the slide transition', () => {
    const state = pushScreen(initialStack, 'chat');
    expect(screenPosition(state, 'chat')).toBe('active');
    expect(screenPosition(state, 'home')).toBe('behind');
    expect(screenPosition(state, 'profile')).toBe('ahead');
  });
});

describe('halo chat text', () => {
  it('splits inline code and leaves unclosed backticks alone', () => {
    expect(splitInlineCode('run `pnpm test` now')).toEqual([
      { text: 'run ', code: false },
      { text: 'pnpm test', code: true },
      { text: ' now', code: false },
    ]);
    expect(splitInlineCode('a `b')).toEqual([{ text: 'a `b', code: false }]);
    expect(splitInlineCode('')).toEqual([{ text: '', code: false }]);
  });
  it('counts and highlights case-insensitive matches with global indexes', () => {
    expect(countMatches('Gmail gmail GMAIL', 'gmail')).toBe(3);
    expect(countMatches('anything', '  ')).toBe(0);
    const segments = highlightSegments('连接 Gmail 和 `gmail.mail`', 'GMAIL', 4);
    expect(segments.filter((s) => s.match).map((s) => [s.text, s.code, s.matchIndex])).toEqual([
      ['Gmail', false, 4],
      ['gmail', true, 5],
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('连接 Gmail 和 gmail.mail');
    expect(countHighlights('a `b`b', 'bb')).toBe(0);
    expect(countHighlights('x `gmail` gmail', 'gmail')).toBe(2);
  });
  it('wraps match stepping', () => {
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(5, 0, 1)).toBe(0);
  });
  it('builds a local template from user prompts only', () => {
    const template = templateFromConversation('AVEN', ['帮我连接 Gmail', '  ', '找\n一家咖啡馆']);
    expect(template).toContain('# AVEN 对话模板');
    expect(template).toContain('1. 帮我连接 Gmail');
    expect(template).toContain('2. 找 一家咖啡馆');
    expect(templateFromConversation('AVEN', [])).toContain('还没有提问');
  });
  it('prepends each active mode prefix exactly once', () => {
    expect(composeModePrefix('你好', {})).toBe('你好');
    expect(composeModePrefix('你好', { deepSearch: true })).toBe('[全网深搜] 你好');
    expect(composeModePrefix('你好', { deepSearch: true, deepThink: true })).toBe(
      '[深度思考] [全网深搜] 你好',
    );
    expect(composeModePrefix('[全网深搜] 你好', { deepSearch: true })).toBe('[全网深搜] 你好');
    expect(composeModePrefix('你好', { funMode: true })).toBe('[幽默风趣] 你好');
    expect(composeModePrefix('', { deepSearch: true })).toBe('[全网深搜] ');
  });
});

describe('halo timeline', () => {
  const now = new Date(2026, 10, 13, 14, 20).getTime();
  it('formats today, yesterday, this year and older timestamps', () => {
    expect(formatChatTimestamp(new Date(2026, 10, 13, 9, 5).getTime(), now)).toBe('今天 09:05');
    expect(formatChatTimestamp(new Date(2026, 10, 12, 19, 38).getTime(), now)).toBe('昨天 19:38');
    expect(formatChatTimestamp(new Date(2026, 9, 1, 8, 0).getTime(), now)).toBe('10月1日 08:00');
    expect(formatChatTimestamp(new Date(2025, 0, 2, 8, 0).getTime(), now)).toBe(
      '2025年1月2日 08:00',
    );
  });
  it('sorts items and inserts separators after five-minute gaps', () => {
    const at = (minutes: number) => now - 60 * 60 * 1000 + minutes * 60 * 1000;
    const entries = buildTimeline(
      [
        { key: 'b', createdAt: at(2) },
        { key: 'a', createdAt: at(0) },
        { key: 'c', createdAt: at(20) },
      ],
      now,
    );
    expect(entries.map((entry) => (entry.kind === 'time' ? 'T' : entry.key))).toEqual([
      'T',
      'a',
      'b',
      'T',
      'c',
    ]);
  });
  it('decides header recall and bottom proximity', () => {
    expect(recallVisible(null, 0, 72)).toBe(false);
    expect(recallVisible(60, 0, 72)).toBe(true);
    expect(recallVisible(200, 0, 72)).toBe(false);
    expect(isNearBottom(1000, 900, 60)).toBe(true);
    expect(isNearBottom(1000, 500, 60)).toBe(false);
  });
});

describe('halo connect-apps catalog', () => {
  it('puts featured plugins first, then ordered categories', () => {
    const sections = groupCatalog(catalog);
    expect(sections[0]?.title).toBe('精选插件');
    expect(sections[0]?.plugins.map((p) => p.id)).toEqual([
      'gmail.mail',
      'aven.calendar',
      'amap.maps',
      'aven.social',
    ]);
    expect(sections.slice(1).map((s) => s.title)).toEqual(['邮箱', '日程', '地图', '购物', '社交']);
  });
  it('flattens search over names, descriptions and categories', () => {
    expect(groupCatalog(catalog, '邮箱')[0]?.plugins.map((p) => p.id)).toEqual([
      'gmail.mail',
      'qqmail.mail',
    ]);
    expect(groupCatalog(catalog, '高德')[0]?.title).toBe('搜索结果');
    expect(groupCatalog(catalog, 'nothing-here')).toEqual([]);
  });
  it('labels buttons by auth type and session mock connections', () => {
    const gmail = catalog[1]!;
    expect(connectButton(gmail, new Set())).toEqual({
      label: '授权',
      tone: 'authorize',
      disabled: false,
    });
    expect(connectButton(catalog[0]!, new Set())).toEqual({
      label: '连接',
      tone: 'neutral',
      disabled: false,
    });
    expect(connectButton(gmail, new Set(['gmail.mail']))).toEqual({
      label: '已连接',
      tone: 'done',
      disabled: true,
    });
    expect(credentialLabel('mock_only')).toBe('尚未接入');
    expect(credentialLabel('missing_credentials')).toBe('缺少凭据');
    expect(credentialLabel('configured')).toBe('已配置');
  });
  it('detects connect intents locally and prefers the longest alias', () => {
    expect(detectConnectorIntent('帮我连接 Gmail', catalog)?.id).toBe('gmail.mail');
    expect(detectConnectorIntent('授权一下 QQ 邮箱', catalog)?.id).toBe('qqmail.mail');
    expect(detectConnectorIntent('连上高德', catalog)?.id).toBe('amap.maps');
    expect(detectConnectorIntent('Gmail 是什么', catalog)).toBeNull();
    expect(detectConnectorIntent('帮我连接一下', catalog)).toBeNull();
  });
  it('maps the master notification switch onto four preferences', () => {
    expect(masterNotificationState(applyMasterNotification(true))).toBe('on');
    expect(masterNotificationState(applyMasterNotification(false))).toBe('off');
    expect(masterNotificationState({ ...applyMasterNotification(true), eventUpdates: false })).toBe(
      'mixed',
    );
  });
  it('counts connected gateway services from real statuses', () => {
    expect(connectedServiceCount([])).toBe(0);
    expect(connectedServiceCount(['connected', undefined, 'pending', 'connected'])).toBe(2);
    expect(connectedServiceCount(['failed', 'expired'])).toBe(0);
  });
  it('picks the catalog row action from gateway mapping and connection state', () => {
    expect(appsRowAction(true, false)).toEqual({
      label: '授权',
      tone: 'authorize',
      disabled: false,
    });
    expect(appsRowAction(true, true)).toEqual({ label: '已连接', tone: 'done', disabled: false });
    expect(appsRowAction(false, false)).toEqual({
      label: '未接入',
      tone: 'neutral',
      disabled: true,
    });
  });
  it('switches the composer main control across voice, send and stop', () => {
    expect(composerAction(false, null)).toBe('voice');
    expect(composerAction(true, null)).toBe('send');
    expect(composerAction(true, 'active')).toBe('stop');
    expect(composerAction(false, 'active')).toBe('stop');
    expect(composerAction(true, 'cancelling')).toBe('stop');
  });
});
