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
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '回到你的 AVEN' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('还没写完', { exact: true })).toHaveCount(0);
});
