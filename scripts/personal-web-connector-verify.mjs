import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
const base = process.env.PERSONAL_WEB_ORIGIN ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Local synthetic verification only.');
// Reuses the synthetic account of the WEB-02 review run so this script does not
// consume the local registration rate limit.
const fixturePath = '.data/personal-web-review-fixture.json';
const statePath = '.data/personal-web-connector-state.json';
mkdirSync('.data', { recursive: true });
const fixture = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath, 'utf8'))
  : { stamp: randomUUID(), password: randomUUID() + '!A7', registered: false };
const { stamp, password } = fixture;
const save = () => writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
save();
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  headless: true,
});
let checks = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  checks++;
  console.log(`PASS ${label}`);
}
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  ...(existsSync(statePath) ? { storageState: statePath } : {}),
});
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const email = `web.review.${stamp}@example.test`;
try {
  await page.goto(base);
  const authenticated = (await context.request.get(`${base}/api/v1/auth/me`)).ok();
  if (!authenticated) {
    await page.getByRole('button', { name: '登录或注册', exact: true }).click();
    if (!fixture.registered) {
      await page.getByRole('button', { name: '还没有账号？注册' }).click();
      await page.getByLabel('怎么称呼你').fill('连接器验证用户');
      await page.getByLabel('邮箱', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
      await expect(
        page.getByText('注册成功，请登录。邮箱验证完成后可发送连接邀请。'),
      ).toBeVisible();
      fixture.registered = true;
      save();
    }
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '今天，想聊点什么？' })).toBeVisible();
    await context.storageState({ path: statePath });
    chmodSync(statePath, 0o600);
  }
  check(true, 'synthetic account reaches the personal workspace');

  await page.getByRole('button', { name: '连接器', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('高德地图', { exact: true })).toBeVisible();
  await expect(page.getByText('AVEN 日程协调', { exact: true })).toBeVisible();
  check(true, 'connector catalog lists built-in connectors by category');
  await expect(page.getByText('缺少凭据', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('仅 Mock', { exact: true }).first()).toBeVisible();
  check(true, 'credential status distinguishes mock-only and missing-credential connectors');

  await page.getByRole('button', { name: '地点与地址检索', exact: true }).click();
  await page.getByLabel('关键词', { exact: true }).fill('西安交通大学');
  await page.getByLabel('城市', { exact: true }).fill('西安');
  await page.getByRole('button', { name: '调用（Mock 模式）', exact: true }).click();
  const mapCard = page.locator('[data-widget-kind="map_location_card"]');
  await expect(mapCard).toBeVisible();
  await expect(mapCard.getByText('Mock 数据', { exact: true })).toBeVisible();
  await expect(mapCard.getByText('西安交通大学', { exact: false }).first()).toBeVisible();
  check(true, 'map widget renders in the conversation with an explicit mock label');

  await mapCard.getByRole('button', { name: '打开导航链接（需你确认）' }).click();
  await expect(mapCard.getByRole('link')).toBeVisible();
  await expect(mapCard.getByText('西安交通大学', { exact: false }).first()).toBeVisible();
  check(true, 'external navigation link requires an explicit confirmation step');
  await mapCard.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('button', { name: '连接器', exact: true }).click();
  await page.getByRole('button', { name: '会话内日程协调卡片', exact: true }).click();
  await page.getByLabel('你的需求', { exact: true }).fill('找下周日下午三点的空闲时间');
  await page.getByRole('button', { name: '调用（Mock 模式）', exact: true }).click();
  const scheduleCard = page.locator('[data-widget-kind="schedule_candidates_card"]');
  await expect(scheduleCard).toBeVisible();
  await expect(scheduleCard.getByText('未修改任何外部日历', { exact: false })).toBeVisible();
  check(true, 'schedule widget renders and states that no external calendar changed');

  const widgets = await (
    await context.request.get(`${base}/api/v1/plugins`, { headers: { Origin: base } })
  ).json();
  check(widgets.plugins.length >= 10, 'connector catalog is served by the real API');

  await page.screenshot({ path: 'var/design/personal-web-connector/desktop.png' });
  check(errors.length === 0, 'no uncaught browser errors');
  console.log(`${checks} checks passed. Synthetic account only; no secrets printed.`);
} finally {
  await context.close();
  await browser.close();
}
