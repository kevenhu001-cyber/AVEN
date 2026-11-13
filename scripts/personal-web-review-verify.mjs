import { closePersonalPanel, openPersonalPanel } from './personal-web-navigation.mjs';
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const base = process.env.PERSONAL_WEB_ORIGIN ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Local synthetic verification only.');
const fixturePath = '.data/personal-web-review-fixture.json';
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
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
      await page.getByLabel('怎么称呼你').fill('复核验证用户');
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
  }
  await expect(page.getByRole('heading', { name: '从一个想法开始' })).toBeVisible();
  check(true, 'synthetic account reaches the personal workspace');

  const csrf = (await context.cookies()).find((c) => c.name === 'aven_csrf')?.value;
  const headers = { Origin: base, 'X-CSRF-Token': csrf ?? '' };

  await openPersonalPanel(page, '记忆与上下文');
  await page.getByRole('tab', { name: '候选复核' }).click();
  await page.getByLabel('描述几件想被记住的事').fill('兴趣：机器人与产品设计\n技能：连接器体验');
  await page.getByRole('button', { name: '提取候选信息', exact: true }).click();
  await expect(page.getByText('提取到 2 条候选，请逐条确认或拒绝。')).toBeVisible();
  check(true, 'server extraction returns pending candidates');

  const candidate = page
    .locator('.personal-app')
    .getByRole('heading', { name: '机器人与产品设计' });
  await expect(candidate).toBeVisible();
  const useBox = page.getByRole('checkbox', { name: /允许用于本人 AI/ }).first();
  check(!(await useBox.isChecked()), 'candidate uses default deny');
  await useBox.check();
  await page.getByRole('button', { name: '确认并保存', exact: true }).first().click();
  await expect(page.getByText('提取到 2 条候选，请逐条确认或拒绝。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '机器人与产品设计' })).toHaveCount(0);
  check(true, 'confirmed candidate leaves the pending queue');

  await page.getByRole('tab', { name: '已确认信息' }).click();
  await expect(page.getByRole('heading', { name: '机器人与产品设计' })).toBeVisible();
  await expect(page.getByText('本人 AI：允许', { exact: true })).toBeVisible();
  check(true, 'confirmed memory shows the selected use');

  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  await page.getByLabel('标题', { exact: true }).fill('机器人与连接器设计');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('heading', { name: '机器人与连接器设计' })).toBeVisible();
  check(true, 'confirmed memory can be edited in place');

  const memories = await (await context.request.get(`${base}/api/v1/memories?limit=10`)).json();
  check(
    memories.data.some((item) => item.title === '机器人与连接器设计'),
    'server keeps the edited memory',
  );

  await page.getByRole('button', { name: '撤回这条信息', exact: true }).first().click();
  await page.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '机器人与连接器设计' })).toHaveCount(0);
  const afterRemoval = await (await context.request.get(`${base}/api/v1/memories?limit=10`)).json();
  check(
    !afterRemoval.data.some((item) => item.title === '机器人与连接器设计'),
    'withdrawn memory is removed on the server',
  );

  await closePersonalPanel(page);
  await page.getByRole('button', { name: '通知', exact: true }).click();
  const inviteBox = page.getByRole('checkbox', { name: '收到连接邀请时通知我' });
  await expect(inviteBox).toBeVisible();
  const before = await (
    await context.request.get(`${base}/api/v1/notifications/preferences`)
  ).json();
  await inviteBox.setChecked(!before.connectionInvitations);
  await expect(page.getByText('通知偏好已保存。')).toBeVisible();
  const after = await (
    await context.request.get(`${base}/api/v1/notifications/preferences`)
  ).json();
  check(
    after.connectionInvitations === !before.connectionInvitations &&
      after.version === before.version + 1,
    'notification preference change persists with a new version',
  );
  check(
    (await inviteBox.isChecked()) === !before.connectionInvitations,
    'notification preference control reflects the saved state',
  );

  const stale = await context.request.post(`${base}/api/v1/notifications/preferences`, {
    headers,
    data: { connectionInvitations: before.connectionInvitations, expectedVersion: before.version },
  });
  check(stale.status() === 409, 'stale preference version is rejected by the server');

  await closePersonalPanel(page);
  check(errors.length === 0, 'no uncaught browser errors');

  mkdirSync('var/design/personal-web-review', { recursive: true });
  await openPersonalPanel(page, '记忆与上下文');
  await page.getByRole('tab', { name: '候选复核' }).click();
  await page.screenshot({ path: 'var/design/personal-web-review/desktop-review.png' });
  await page.getByRole('tab', { name: '已确认信息' }).click();
  await page.screenshot({ path: 'var/design/personal-web-review/desktop-memories.png' });
  await closePersonalPanel(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page
    .getByRole('button', { name: '记忆与上下文', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator('.workspace-page')).toBeVisible();
  await page.screenshot({ path: 'var/design/personal-web-review/mobile-review.png' });
  console.log(`${checks} checks passed. Synthetic account only; no secrets printed.`);
} finally {
  await context.close();
  await browser.close();
}
