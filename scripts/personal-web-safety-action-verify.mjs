import { closePersonalPanel, openPersonalPanel } from './personal-web-navigation.mjs';
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const base = process.env.PERSONAL_WEB_ORIGIN ?? 'https://aven.topodrive.top';
if (new URL(base).origin !== 'https://aven.topodrive.top')
  throw new Error('Authorized validation origin only.');
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  headless: true,
});
let checks = 0;
const check = (ok, label) => {
  if (!ok) throw new Error(label);
  checks++;
  console.log(`PASS ${label}`);
};
const errors = [];
try {
  const contexts = [];
  for (const name of ['B', 'connector']) {
    const state = JSON.parse(readFileSync(`.data/personal-web-${name}-state.json`, 'utf8'));
    const context = await browser.newContext({
      storageState: {
        cookies: state.cookies.map((cookie) => ({
          ...cookie,
          domain: new URL(base).hostname,
          secure: true,
        })),
        origins: [],
      },
    });
    const me = await context.request.get(`${base}/api/v1/auth/me`);
    check(me.ok(), 'stored synthetic session remains valid without login retry');
    contexts.push({ context, me: await me.json() });
  }
  const [a, b] = contexts;
  check(a.me.user.id !== b.me.user.id, 'two independent synthetic actors');
  const page = await a.context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await openPersonalPanel(page, '记忆与上下文');
  await page.getByRole('tab', { name: '行动草稿', exact: true }).click();
  await page.getByLabel('草稿标题').fill(`行动验证-${randomUUID()}`);
  await page.getByLabel('草稿正文').fill('合成测试正文；用途默认关闭。');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/actions') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '生成行动预览', exact: true }).click();
  const createResponse = await created;
  check(createResponse.ok(), 'UI creates a pending draft without executing memory creation');
  const draft = await createResponse.json();
  check(
    draft.status === 'pending_confirmation' && draft.preview.allowedUses.length === 0,
    'preview retains deny-by-default purposes',
  );
  await expect(page.getByText('状态：pending_confirmation', { exact: false })).toBeVisible();
  const confirmed = page.waitForResponse((response) => response.url().endsWith('/confirm'));
  await page.getByRole('button', { name: '确认创建记忆', exact: true }).click();
  check((await confirmed).ok(), 'explicit UI confirmation executes action with CSRF');
  await expect(page.getByText('状态：succeeded', { exact: false })).toBeVisible();
  const foreign = await b.context.request.get(`${base}/api/v1/actions/${draft.id}`);
  check(foreign.status() === 404, 'another actor cannot read private action preview');
  await page.getByRole('button', { name: '核对行动状态', exact: true }).click();
  await expect(page.getByText('状态：succeeded', { exact: false })).toBeVisible();
  check(true, 'executed action is readable without a second write');
  await closePersonalPanel(page);
  await openPersonalPanel(page, '我的账号');
  await page.getByLabel('对方连接码', { exact: true }).fill(`aven:${b.me.user.id}`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '拉黑用户', exact: true }).click();
  await expect(page.getByRole('button', { name: '解除拉黑', exact: true }).first()).toBeVisible();
  const blocks = await (await a.context.request.get(`${base}/api/v1/blocks`)).json();
  check(
    blocks.blocks.some((block) => block.blockedUserId === b.me.user.id),
    'UI block persists for the current actor',
  );
  const blockCard = page.locator('.memory-card').filter({ hasText: `aven:${b.me.user.id}` });
  page.once('dialog', (dialog) => dialog.accept());
  await blockCard.getByRole('button', { name: '解除拉黑', exact: true }).click();
  await expect(blockCard).toHaveCount(0);
  check(true, 'UI explicit unblock refreshes authoritative records');
  await page.getByLabel('对方连接码', { exact: true }).fill(`aven:${b.me.user.id}`);
  page.once('dialog', (dialog) => dialog.accept());
  const reported = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/reports') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '提交举报', exact: true }).click();
  check((await reported).ok(), 'UI submits synthetic report after explicit confirmation');
  await closePersonalPanel(page);
  const newRuns = [];
  for (const actor of contexts) {
    const csrf = (await actor.context.cookies()).find(
      (cookie) => cookie.name === 'aven_csrf',
    )?.value;
    const turn = await actor.context.request.post(`${base}/api/v1/agent/turns`, {
      headers: { 'X-CSRF-Token': csrf ?? '', 'Idempotency-Key': randomUUID(), Origin: base },
      data: { input: 'Synthetic history isolation verification only.' },
    });
    check(turn.ok(), 'synthetic actor creates a separate personal run');
    newRuns.push(await turn.json());
  }
  const [historyA, historyB] = await Promise.all(
    contexts.map(async (actor) =>
      (await actor.context.request.get(`${base}/api/v1/agent/runs?limit=50`)).json(),
    ),
  );
  check(
    historyA.data.every((row) => !historyB.data.some((other) => other.id === row.id)),
    'history lists do not cross independent actors',
  );
  check(
    historyA.data.some((row) => row.id === newRuns[0].runId) &&
      historyB.data.some((row) => row.id === newRuns[1].runId),
    'each history includes its own new run',
  );
  const foreignRun = historyB.data.find((row) => row.id === newRuns[1].runId);
  if (foreignRun) {
    check(
      (await a.context.request.get(`${base}/api/v1/agent/runs/${foreignRun.id}`)).status() === 404,
      'foreign run id remains inaccessible',
    );
    check(
      (
        await a.context.request.get(`${base}/api/v1/agent/runs/${foreignRun.id}/events`)
      ).status() === 404,
      'foreign SSE replay remains inaccessible',
    );
  }
  check(errors.length === 0, 'no uncaught browser errors');
  console.log(`${checks} safety/action checks passed; synthetic sessions only.`);
} finally {
  await browser.close();
}
