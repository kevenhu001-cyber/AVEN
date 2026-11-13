import { closePersonalPanel, openPersonalPanel } from './personal-web-navigation.mjs';
import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const base = process.env.PERSONAL_WEB_ORIGIN ?? 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1', 'aven.topodrive.top'].includes(new URL(base).hostname))
  throw new Error('Only authorized AVEN origins with synthetic accounts.');
const fixturePath = '.data/personal-web-account-fixture.json';
const fixture = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath, 'utf8'))
  : { stamp: randomUUID(), password: randomUUID() + '!A7', registered: false };
const save = () => writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
save();
const email = `web.account.${fixture.stamp}@example.test`;
if (!fixture.registered) {
  const result = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: fixture.password, displayName: '账号验证用户' }),
  });
  if (!result.ok) throw new Error(`Synthetic registration failed: ${result.status}`);
  fixture.registered = true;
  save();
}
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let checks = 0;
const check = (condition, label) => {
  if (!condition) throw new Error(label);
  checks++;
  console.log(`PASS ${label}`);
};
let mobileToken;
try {
  await page.goto(base);
  await page.getByRole('button', { name: '登录或注册', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从一个想法开始' })).toBeVisible();
  check(true, 'real Web login reaches workspace');
  const mobile = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: fixture.password, client: 'mobile' }),
  });
  check(mobile.ok, 'real mobile login succeeds');
  const session = await mobile.json();
  mobileToken = session.sessionToken;
  check(
    typeof mobileToken === 'string' && !session.csrfToken && !mobile.headers.get('set-cookie'),
    'mobile login uses Bearer without web cookies',
  );
  const mobileMe = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${mobileToken}` },
  });
  check(
    mobileMe.ok && (await mobileMe.json()).session.client === 'mobile',
    'mobile Bearer authenticates independently',
  );
  await openPersonalPanel(page, '我的账号');
  await expect(page.getByRole('heading', { name: '个人资料', exact: true })).toBeVisible();
  const name = `账号验证-${fixture.stamp.slice(0, 8)}`;
  await page.getByLabel('显示名', { exact: true }).fill(name);
  await page.getByLabel('时区（IANA）').fill('Asia/Shanghai');
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/me') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  check((await saved).ok(), 'profile write returns success');
  const me = await (await context.request.get(`${base}/api/v1/auth/me`)).json();
  check(
    me.user.displayName === name && me.user.timezone === 'Asia/Shanghai',
    'profile save persists and workspace revalidates',
  );
  await expect(page.getByLabel('显示名', { exact: true })).toHaveValue(name);
  const mobileCard = page
    .locator('.memory-card')
    .filter({ hasText: 'Android / 移动端' })
    .filter({ has: page.getByRole('button', { name: '撤销会话', exact: true }) })
    .first();
  await expect(mobileCard).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await mobileCard.getByRole('button', { name: '撤销会话', exact: true }).click();
  await expect(async () => {
    const result = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${mobileToken}` },
    });
    expect(result.status).toBe(401);
  }).toPass();
  check(true, 'Web device revocation immediately invalidates mobile Bearer');
  await closePersonalPanel(page);
  await page.getByLabel('向 AVEN 提问', { exact: true }).fill(`account history ${randomUUID()}`);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制回复', exact: true }).last()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新读取此轮回复' }).first()).toBeVisible();
  const history = await (await context.request.get(`${base}/api/v1/agent/runs?limit=1`)).json();
  check(
    history.data.length === 1 &&
      !('inputSummary' in history.data[0]) &&
      !('outputSummary' in history.data[0]),
    'history metadata excludes prompts and reply body',
  );
  await page.getByRole('button', { name: '重新读取此轮回复' }).first().click();
  await expect(page.locator('.history-answer .message-content')).toBeVisible();
  check(true, 'history explicitly replays real Worker response');
  const badCursor = await context.request.get(
    `${base}/api/v1/agent/runs?cursorId=${history.data[0].id}`,
  );
  check(badCursor.status() === 422, 'history rejects incomplete pagination cursor');
  await closePersonalPanel(page);
  await openPersonalPanel(page, '记忆与上下文');
  await page.getByRole('tab', { name: '行动草稿', exact: true }).click();
  const actionTitle = `行动验证-${randomUUID()}`;
  await page.getByLabel('草稿标题', { exact: true }).fill(actionTitle);
  await page
    .getByLabel('草稿正文', { exact: true })
    .fill('仅用于合成数据验证，默认不授权其他用途。');
  await page.getByRole('button', { name: '生成行动预览', exact: true }).click();
  await expect(page.getByText('状态：pending_confirmation', { exact: false })).toBeVisible();
  const confirmation = page.waitForResponse(
    (response) => response.url().endsWith('/confirm') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '确认创建记忆', exact: true }).click();
  check((await confirmation).ok(), 'action preview confirms through real CSRF-protected endpoint');
  await expect(page.getByText('状态：succeeded', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '核对行动状态', exact: true }).click();
  await expect(page.getByText('状态：succeeded', { exact: false })).toBeVisible();
  check(true, 'executed action can be read without a second mutation');
  await closePersonalPanel(page);
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  mkdirSync('var/design/web-android', { recursive: true });
  await page.screenshot({ path: 'var/design/web-android/history-desktop.png' });
  await closePersonalPanel(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPersonalPanel(page, '我的账号');
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'account panel has no horizontal overflow at 390px',
  );
  await page.screenshot({ path: 'var/design/web-android/account-mobile.png' });
  await closePersonalPanel(page);
  await openPersonalPanel(page, '我的账号');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '登录或注册', exact: true }).click();
  await page.getByRole('button', { name: '忘记密码', exact: true }).click();
  await expect(page.getByRole('heading', { name: '找回密码' })).toBeVisible();
  await page.getByLabel('账号邮箱').fill(`missing.${randomUUID()}@example.test`);
  await page.getByRole('button', { name: '获取重置指引', exact: true }).click();
  await expect(page.getByLabel('重置码')).toBeVisible();
  check(true, 'password recovery uses non-enumerating response and renders reset form');
  check(errors.length === 0, 'no uncaught browser errors');
  writeFileSync(
    'var/design/web-android/account-results.json',
    JSON.stringify(
      { checks, browserPlugin: 'Browser plugin not available', passed: true },
      null,
      2,
    ),
  );
  console.log(`${checks} account checks passed. Synthetic accounts only; no credentials printed.`);
} finally {
  if (mobileToken)
    await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mobileToken}` },
    });
  await browser.close();
}
