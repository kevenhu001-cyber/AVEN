import { expect, test } from '@playwright/test';
const id = 'e521efc6-60c7-4725-aabe-9c31cff1bab9';
const timestamp = '2026-11-12T00:00:00.000Z';
// Transport fixtures only; live business verification is scripts/personal-web-verify.mjs.
const me = {
  user: {
    id,
    displayName: '合成界面测试',
    email: 'ui-state@example.test',
    emailVerified: true,
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
  },
  session: {
    id,
    client: 'web',
    userAgent: null,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
    current: true,
  },
};
test('session service failure stays retryable and hides private workspace', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '暂时无法连接' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeEnabled();
  await expect(page.getByLabel('与 AVEN 对话')).toHaveCount(0);
});
test('login errors never render upstream private text', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ private: 'DO_NOT_RENDER_UPSTREAM' }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByText('DO_NOT_RENDER_UPSTREAM')).toHaveCount(0);
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
});
test('IME and multiline input do not submit; session expiry removes modal and draft', async ({
  page,
  context,
}) => {
  let expired = false;
  let sends = 0;
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: expired ? 401 : 200,
      contentType: 'application/json',
      body: expired ? '{}' : JSON.stringify(me),
    }),
  );
  await page.route('**/api/v1/agent/turns', async (route) => {
    sends++;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  await page.goto('/');
  // Halo home first; the mascot opens the chat screen (ADR-018).
  await page.getByRole('button', { name: '与 AVEN 对话', exact: true }).click();
  const input = page.getByLabel('向 AVEN 提问', { exact: true });
  await input.fill('还没写完');
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 229,
    isComposing: true,
  });
  expect(sends).toBe(0);
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('还没写完\n');
  expect(sends).toBe(0);
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '核对发送结果', exact: true })).toBeVisible();
  expect(sends).toBe(1);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: '账号与设置' })).toBeVisible();
  expired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '回到你的 AVEN' })).toBeVisible();
  await expect(page.getByText('还没写完', { exact: true })).toHaveCount(0);
});

test('chat menu remains open when reopened during its exit transition', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(me) }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '与 AVEN 对话', exact: true }).click();
  const trigger = page.getByRole('button', { name: '更多', exact: true });
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menu').press('Escape');
  await trigger.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('menu')).toHaveAttribute('data-state', 'open');
  await page.waitForTimeout(250);
  await expect(page.getByRole('menu')).toHaveAttribute('data-state', 'open');
});

test('assistant replies animate in, quick prompts send, and copy confirms', async ({
  page,
  context,
}) => {
  const runId = '11111111-1111-4111-8111-111111111111';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(me) }),
  );
  await page.route('**/api/v1/agent/turns', (route) =>
    route.fulfill({
      status: 201,
      json: {
        runId,
        conversationId: '22222222-2222-4222-8222-222222222222',
        status: 'queued',
        streamUrl: `/api/v1/agent/runs/${runId}/events`,
      },
    }),
  );
  await page.route('**/api/v1/agent/runs/*/events', async (route) => {
    const timestamp = new Date().toISOString();
    const frames = [
      { id: 1, type: 'turn.started' },
      { id: 2, type: 'message.delta', text: '你好，' },
      { id: 3, type: 'message.delta', text: '我是 AVEN。' },
      { id: 4, type: 'turn.completed' },
    ];
    const body = frames
      .map(
        (frame) =>
          `id: ${frame.id}\nevent: ${frame.type}\ndata: ${JSON.stringify({
            schema_version: 1,
            run_id: runId,
            sequence: frame.id,
            timestamp,
            ...(frame.text ? { text: frame.text } : {}),
          })}\n\n`,
      )
      .join('');
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body,
    });
  });
  await page.goto('/chat');
  await page.getByRole('button', { name: '帮我整理今天的想法', exact: true }).click();
  await expect(page.getByText('回复完成', { exact: true })).toBeVisible();
  const userBubble = page.locator('.user-bubble').last();
  await expect(userBubble).toHaveText('帮我整理今天的想法');
  expect(await userBubble.evaluate((node) => getComputedStyle(node).animationName)).toContain(
    'halo-bubble-out',
  );
  const bubble = page.locator('.assistant-bubble').last();
  await expect(bubble).toHaveText('你好，我是 AVEN。');
  expect(await bubble.evaluate((node) => getComputedStyle(node).animationName)).toContain(
    'halo-bubble-in',
  );
  await page.locator('.chat-turn').last().hover();
  await page.getByRole('button', { name: '复制回复', exact: true }).click();
  await expect(page.getByText('已复制', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('你好，我是 AVEN。');
});
