import { closePersonalPanel, openPersonalPanel } from './personal-web-navigation.mjs';
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { resolve } from 'node:path';
const base = process.env.PERSONAL_WEB_ORIGIN ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Local synthetic verification only.');
const fixturePath = '.data/personal-web-fixture.json';
mkdirSync('.data', { recursive: true });
const fixture = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath, 'utf8'))
  : { stamp: randomUUID(), password: randomUUID() + '!A7', registered: [] };
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
const contexts = [];
const errors = [];
async function account(suffix) {
  const statePath = `.data/personal-web-${suffix}-state.json`;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(statePath) ? { storageState: statePath } : {}),
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on('response', (res) => {
    if (res.url().includes('/events'))
      console.log('SSE HTTP status:', res.status(), res.headers()['content-type']);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const email = `web.${suffix.toLowerCase()}.${stamp}@example.test`;
  const authenticated = (await context.request.get(`${base}/api/v1/auth/me`)).ok();
  await page.goto(base);
  if (!authenticated) {
    await page.getByRole('button', { name: '登录或注册', exact: true }).click();
    if (!fixture.registered.includes(suffix)) {
      await page.getByRole('button', { name: '还没有账号？注册' }).click();
      await page.getByLabel('怎么称呼你').fill(`验证用户 ${suffix}`);
      await page.getByLabel('邮箱', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
      await expect(
        page.getByText('注册成功，请登录。邮箱验证完成后可发送连接邀请。'),
      ).toBeVisible();
      fixture.registered.push(suffix);
      save();
    }
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '从一个想法开始' })).toBeVisible();
  await context.storageState({ path: statePath });
  chmodSync(statePath, 0o600);
  const meResponse = await context.request.get(`${base}/api/v1/auth/me`);
  check(meResponse.ok(), `${suffix}: UI registration/login reaches real session`);
  const me = await meResponse.json();
  const cookies = await context.cookies();
  check(
    cookies.some((c) => c.name === 'aven_session' && c.httpOnly) &&
      cookies.some((c) => c.name === 'aven_csrf' && !c.httpOnly),
    `${suffix}: cookie and CSRF separation`,
  );
  let token;
  for (const file of readdirSync('.data/mail').filter((f) => f.endsWith('.json'))) {
    const mail = JSON.parse(readFileSync(resolve('.data/mail', file), 'utf8'));
    if (mail.to === email && mail.kind === 'verify_email')
      token = /验证令牌：(\S+)/.exec(mail.text)?.[1];
  }
  check(Boolean(token), `${suffix}: synthetic development verification mail exists`);
  await openPersonalPanel(page, '我的账号');
  if (!me.user.emailVerified) {
    await page.getByLabel('邮箱验证码', { exact: true }).fill(token);
    await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
  }
  await expect(page.getByText('邮箱已验证', { exact: true })).toBeVisible();
  await closePersonalPanel(page);
  return { context, page, me };
}
try {
  const a = await account('A');
  await a.page.getByLabel('向 AVEN 提问', { exact: true }).fill('这是合成验证，请回复。');
  await a.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(a.page.getByRole('button', { name: '复制回复', exact: true }).last()).toBeVisible({
    timeout: 25000,
  });
  check(
    (await a.page.locator('.assistant-bubble').innerText()).includes('Mock'),
    'real API/Outbox/Worker/SSE terminal response',
  );
  await openPersonalPanel(a.page, '记忆与上下文');
  await a.page.locator('.memory-create summary').click();
  await a.page.getByLabel('一条想让 AVEN 了解的信息').fill('合成测试介绍');
  await a.page
    .getByLabel('具体内容', { exact: true })
    .fill('合成验证资料：我喜欢机器人和产品设计。');
  check(
    !(await a.page.getByLabel('允许用于本人 AI').isChecked()) &&
      !(await a.page.getByLabel('允许进入共享预览', { exact: false }).isChecked()),
    'memory uses default deny',
  );
  await a.page.getByLabel('允许进入共享预览', { exact: false }).check();
  await a.page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(
    a.page.getByRole('heading', { name: '合成测试介绍', exact: true }).first(),
  ).toBeVisible();
  await closePersonalPanel(a.page);
  const b = await account('B');
  const prior = await (
    await a.context.request.get(`${base}/api/v1/connections/invitations`)
  ).json();
  const csrf = (await a.context.cookies()).find((c) => c.name === 'aven_csrf')?.value;
  for (const invite of prior.data.filter(
    (i) =>
      i.senderUserId === a.me.user.id &&
      i.recipientUserId === b.me.user.id &&
      i.status === 'pending',
  )) {
    const cleanup = await a.context.request.post(
      `${base}/api/v1/connections/invitations/${invite.id}/withdraw`,
      {
        headers: { Origin: base, 'X-CSRF-Token': csrf },
        data: { expectedVersion: invite.version },
      },
    );
    if (!cleanup.ok()) throw new Error('Unable to withdraw prior synthetic pending fixture.');
  }
  const linked = await (await a.context.request.get(`${base}/api/v1/connections`)).json();
  await openPersonalPanel(a.page, '我的连接');
  if (!linked.data.length) {
    const invitationCountBefore = (
      await (await b.context.request.get(`${base}/api/v1/connections/invitations`)).json()
    ).data.length;
    await a.page.getByRole('button', { name: '发起连接邀请', exact: true }).click();
    await a.page.getByLabel('对方的连接码', { exact: true }).fill(`aven:${b.me.user.id}`);
    await a.page.getByRole('checkbox', { name: '合成测试介绍', exact: false }).first().check();
    await a.page.getByRole('button', { name: '查看共享预览', exact: true }).click();
    await expect(a.page.getByRole('heading', { name: '发送前，看看共享什么' })).toBeVisible();
    const before = await b.context.request.get(`${base}/api/v1/connections/invitations`);
    check(
      before.ok() && (await before.json()).data.length === invitationCountBefore,
      'preview does not send an invitation',
    );
    await a.page.getByRole('button', { name: '确认并发送邀请', exact: true }).click();
    await expect(a.page.getByRole('button', { name: /我发出的邀请.*等待回应/ })).toBeVisible();
    await openPersonalPanel(b.page, '我的连接');
    await b.page.getByRole('button', { name: /收到一份连接邀请.*等待回应/ }).click();
    await expect(
      b.page.getByText('合成验证资料：我喜欢机器人和产品设计。', { exact: false }),
    ).toBeVisible();
    await b.page.getByRole('button', { name: '接受连接', exact: true }).click();
  } else {
    await openPersonalPanel(b.page, '我的连接');
  }
  await b.page.getByRole('button', { name: /已建立的连接/ }).click();
  await b.page.getByLabel('给对方留言', { exact: true }).fill('合成验证：连接后的第一条消息。');
  await b.page.getByRole('button', { name: '发送给对方', exact: true }).click();
  await expect(
    b.page
      .locator('.peer-message')
      .getByText('合成验证：连接后的第一条消息。', { exact: true })
      .first(),
  ).toBeVisible();
  await a.page.getByRole('button', { name: '刷新连接', exact: true }).click();
  await a.page.getByRole('button', { name: /已建立的连接/ }).click();
  await expect(
    a.page
      .locator('.peer-message')
      .getByText('合成验证：连接后的第一条消息。', { exact: true })
      .first(),
  ).toBeVisible();
  check(
    true,
    linked.data.length
      ? 'existing synthetic connection send/read (initial preview/accept previously verified)'
      : 'two isolated UI sessions preview/consent/connect/send/read',
  );
  await closePersonalPanel(a.page);
  await a.page.getByRole('button', { name: '通知', exact: true }).click();
  await expect(async () => {
    await a.page.getByRole('button', { name: '刷新通知', exact: true }).click();
    await expect(a.page.getByText('连接邀请已接受', { exact: false }).first()).toBeVisible();
  }).toPass({ timeout: 15000 });
  check(true, 'real inbox notification from Worker');
  await closePersonalPanel(a.page);
  if (await a.page.getByRole('button', { name: '重新读取回复', exact: true }).isVisible())
    await a.page.getByRole('button', { name: '重新读取回复', exact: true }).click();
  await expect(a.page.getByRole('button', { name: '复制回复', exact: true }).last()).toBeVisible();
  mkdirSync('var/design/personal-web', { recursive: true });
  await a.page.screenshot({ path: 'var/design/personal-web/desktop.png' });
  for (const width of [320, 390, 768]) {
    await a.page.setViewportSize({ width, height: 844 });
    check(
      await a.page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
      `responsive overflow ${width}px`,
    );
  }
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.screenshot({ path: 'var/design/personal-web/mobile.png' });
  await a.page.getByRole('button', { name: '打开导航', exact: true }).click();
  await a.page
    .getByRole('button', { name: '我的连接', exact: true })
    .filter({ visible: true })
    .click();
  await expect(a.page.locator('.workspace-page')).toBeVisible();
  await closePersonalPanel(a.page);
  await a.page.getByRole('button', { name: '打开导航', exact: true }).click();
  await a.page.keyboard.press('Escape');
  await expect(a.page.getByRole('dialog')).toHaveCount(0);
  check(true, 'mobile navigation and Escape drawer close');
  await a.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(a.page.getByLabel('会话校验')).toBeVisible();
  await expect(a.page.locator('.assistant-bubble')).toHaveCount(0);
  await a.page.getByRole('button', { name: '重新验证会话', exact: true }).click();
  await expect(a.page.getByRole('button', { name: '重新读取回复', exact: true })).toBeVisible();
  check(true, 'offline hides derived content; revalidation requires explicit replay');
  await openPersonalPanel(a.page, '我的账号');
  await a.page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(a.page.getByRole('heading', { name: '回到你的 AVEN' })).toBeVisible();
  check(
    (await a.context.request.get(`${base}/api/v1/auth/me`)).status() === 401,
    'logout invalidates real server session',
  );
  check(
    await a.page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0),
    'no private content or bearer token in browser storage',
  );
  check(errors.length === 0, 'no uncaught browser errors');
  console.log(`${checks} checks passed. Synthetic accounts only; no secrets printed.`);
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
}
