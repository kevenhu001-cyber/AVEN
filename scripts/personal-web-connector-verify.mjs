import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { openChat, openConnectorDialog, openPluginDirectory } from './lib/personal-web-nav.mjs';
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
    await openChat(page);
    await expect(page.getByRole('heading', { name: '今天想探索什么？' })).toBeVisible();
    await context.storageState({ path: statePath });
    chmodSync(statePath, 0o600);
  }
  check(true, 'synthetic account reaches the personal workspace');

  await openChat(page);

  const dialog = await openConnectorDialog(page);
  await expect(page).toHaveURL(/\/chat$/);
  await expect(dialog.getByText('高德地图', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await openPluginDirectory(page);
  await expect(page.getByText('高德地图', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('AVEN 日程协调', { exact: true }).first()).toBeVisible();
  check(true, 'connector catalog lists built-in connectors by category');
  await expect(page.getByText('缺少凭据', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('尚未接入', { exact: true }).first()).toBeVisible();
  check(true, 'credential status distinguishes mock-only and missing-credential connectors');

  await page
    .getByRole('button', { name: /^高德地图/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: '地点与地址检索', exact: true })).toBeDisabled();
  await expect(page.getByText('未配置真实凭据，动作暂不可用。', { exact: false })).toBeVisible();
  check(true, 'connector without real credentials cannot run a simulated action');

  await page.goto('/apps/gmail.mail');
  await expect(page.getByRole('link', { name: /账号授权/ })).toBeVisible();
  check(true, 'gateway-backed connector links to real account authorization');

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
