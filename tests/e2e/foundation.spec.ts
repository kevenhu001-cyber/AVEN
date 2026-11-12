import { expect, test } from '@playwright/test';

test('foundation page is honest, responsive, and reaches the live probe through the web proxy', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/diagnostics');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('从可靠的连接开始。');
  await expect(page.getByText('本页不是 MVP，也不是核心产品 UI。')).toBeVisible();
  await expect(page.getByText('页面与双端设计评审尚未完成。', { exact: false })).toBeVisible();
  await expect(
    page.getByText('语义召回、真实 AI 与移动推送尚未实现。', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '检查连接' })).toBeEnabled();
  await page.getByRole('button', { name: '检查连接' }).click();
  await expect(page.getByText('API 进程可访问')).toBeVisible();
  await expect(page.getByText('仅证明存活，不代表数据库或业务已就绪。')).toBeVisible();
  expect(requests.some((url) => new URL(url).pathname === '/health/live')).toBe(true);
  expect(requests.some((url) => url.includes('3001'))).toBe(false);
});

test('readiness failure is not rendered as a successful connection', async ({ page }) => {
  const response = await page.request.get('/health/ready');
  expect(response.status()).toBe(503);
  const body = await response.json();
  expect(body.error.code).toBe('SERVICE_NOT_READY');
  expect(body.error.retryable).toBe(true);
  await page.goto('/diagnostics');
  await expect(page.getByText('尚未检查。请先在另一个终端启动 API。')).toBeVisible();
  await page.getByRole('button', { name: '检查依赖' }).click();
  await expect(page.getByText('依赖尚未就绪')).toBeVisible();
  await expect(page.getByText('依赖已就绪')).toHaveCount(0);
});

test('no horizontal overflow at the mobile viewport', async ({ page }) => {
  await page.goto('/diagnostics');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: '检查连接' })).toBeVisible();
});
