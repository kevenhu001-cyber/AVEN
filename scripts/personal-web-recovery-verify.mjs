import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const base = process.env.PERSONAL_WEB_ORIGIN ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Local synthetic verification only.');
const fixture = JSON.parse(readFileSync('.data/personal-web-fixture.json', 'utf8'));
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  headless: true,
});
const context = await browser.newContext({
  storageState: '.data/personal-web-B-state.json',
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let checks = 0;
const check = (value, label) => {
  if (!value) throw new Error(label);
  console.log(`PASS ${label}`);
  checks++;
};
try {
  const meResponse = await context.request.get(`${base}/api/v1/auth/me`);
  if (
    !meResponse.ok() ||
    (await meResponse.json()).user.email !== `web.b.${fixture.stamp}@example.test`
  )
    throw new Error('Expected synthetic B session from personal-web-verify.');
  const keys = [],
    runs = [];
  await page.route('**/api/v1/agent/turns', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    const result = await route.fetch();
    runs.push((await result.json()).runId);
    if (keys.length === 1) await route.abort('failed');
    else await route.fulfill({ response: result });
  });
  await page.goto(base);
  await page.getByLabel('向 AVEN 提问', { exact: true }).fill('合成验证：发送结果未知，手动核对。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '核对发送结果', exact: true })).toBeVisible();
  check(keys.length === 1, 'unknown result does not automatically resubmit');
  await page.getByRole('button', { name: '核对发送结果', exact: true }).click();
  await expect(page.getByText('回复完成', { exact: true })).toBeVisible({ timeout: 15000 });
  check(
    keys.length === 2 && keys[0] === keys[1] && runs[0] === runs[1],
    'manual retry keeps same key and real run',
  );
  await page.unroute('**/api/v1/agent/turns');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  let streamRequests = 0;
  await page.route('**/api/v1/agent/runs/*/events', async (route) => {
    streamRequests++;
    if (streamRequests > 1) return route.continue();
    const result = await route.fetch();
    const text = await result.text();
    const firstDelta = text.split('\n\n').find((frame) => frame.includes('event: message.delta'));
    if (!firstDelta) throw new Error('Real Worker stream had no delta.');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: firstDelta + '\n\n',
    });
  });
  await page.getByLabel('向 AVEN 提问', { exact: true }).fill('合成验证：截断后的重新读取。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新读取回复', exact: true })).toBeVisible({
    timeout: 15000,
  });
  check(
    streamRequests === 1 && (await page.locator('.assistant-bubble').count()) === 0,
    'truncated stream clears derived output and does not auto-reconnect',
  );
  await page.getByRole('button', { name: '重新读取回复', exact: true }).click();
  await expect(page.getByText('回复完成', { exact: true })).toBeVisible();
  check(streamRequests === 2, 'explicit replay reuses the real run');
  // Failure injection only: the backend response is completed, but this transport holds a running frame.
  await page.unroute('**/api/v1/agent/runs/*/events');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/agent/runs/*/events', async (route) => {
    const result = await route.fetch();
    const text = await result.text();
    const started = text.split('\n\n').find((frame) => frame.includes('event: turn.started'));
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: started + '\n\n' });
    release();
  });
  await page.getByLabel('向 AVEN 提问', { exact: true }).fill('合成验证：停止后的状态核对。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  // Use the visible queued control before the intentionally incomplete stream ends.
  const stop = page.getByRole('button', { name: '停止回复', exact: true });
  const cancellation = page.waitForResponse((response) => response.url().endsWith('/cancel'));
  await stop.click();
  const cancelResult = await (await cancellation).json();
  await held;
  await expect(
    page.getByText(cancelResult.status === 'cancelled' ? '已停止' : '回复完成', { exact: true }),
  ).toBeVisible();
  check(
    ['cancelled', 'completed'].includes(cancelResult.status),
    'stop UI matches actual server terminal result',
  );
  await page.unroute('**/api/v1/agent/runs/*/events');
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '回到你的 AVEN' })).toBeVisible();
  check(
    (await page.locator('.chat-turn').count()) === 0 &&
      (await page.getByRole('dialog').count()) === 0,
    '401 clears all private workspace',
  );
  check(errors.length === 0, 'recovery flows have no uncaught browser error');
  console.log(`${checks} recovery checks passed; failures injected in browser transport only.`);
} finally {
  await context.close();
  await browser.close();
}
