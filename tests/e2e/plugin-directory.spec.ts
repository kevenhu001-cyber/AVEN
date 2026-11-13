import { expect, test } from '@playwright/test';
const plugin = {
  id: 'amap.maps',
  name: '高德地图',
  providerName: '合成界面测试',
  description: '地点与地址检索',
  version: '1.0.0',
  category: 'maps',
  authType: 'api_key',
  credentialStatus: 'missing_credentials',
  allowedExternalHosts: ['uri.amap.com'],
  supportsLiveAdapter: true,
  readOnly: true,
  actions: [
    {
      name: 'search_poi',
      title: '地点检索',
      description: '按关键词查地址',
      requiredPermissions: ['plugin:invoke:maps'],
      widgetKinds: ['map_location_card'],
      idempotent: true,
      timeoutMs: 5000,
      maxRetries: 1,
      inputJsonSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/plugins', (route) =>
    route.fulfill({ json: { plugins: [plugin], total: 1 } }),
  );
});
test('directory filters services and explains upcoming capabilities', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/plugins');
  await expect(page.getByRole('heading', { name: '给对话更多能力' })).toBeVisible();
  await page.getByLabel('搜索插件').fill('Slack');
  await expect(page.locator('.plugin-tile')).toHaveCount(1);
  await page.getByRole('link', { name: /Slack/ }).click();
  await expect(page).toHaveURL(/\/plugins\/slack$/);
  await expect(
    page.locator('.plugin-detail').getByRole('heading', { name: 'Slack', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.plugin-detail .plugin-state')).toHaveText('即将开放');
  await expect(page.getByRole('button', { name: '调用（Mock 模式）' })).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('img[src="/connector-icons/slack.svg"]')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.goto('/plugins');
  await expect(page.locator('.plugin-tile')).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('plugins.png'), fullPage: true });
  await page.getByRole('button', { name: '地图', exact: true }).click();
  await expect(page.locator('.plugin-tile')).toHaveCount(2);
  await page.getByLabel('搜索插件').fill('不存在的服务');
  await expect(page.getByRole('heading', { name: '没有匹配的插件' })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('.plugin-tile')).toHaveCount(10);
});
test('detail invokes only the selected mock action', async ({ page, context }) => {
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  let calls = 0;
  await page.route('**/api/v1/plugins/amap.maps/invoke', async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({
      action: 'search_poi',
      input: { query: '合成地点' },
      allowLive: false,
    });
    await route.fulfill({
      json: {
        invocationId: '11111111-1111-4111-8111-111111111111',
        pluginId: 'amap.maps',
        action: 'search_poi',
        providerMode: 'mock',
        summary: '合成地点检索完成',
        data: {},
        widgets: [],
        auditRef: 'synthetic-audit',
        executedAt: '2026-11-13T00:00:00.000Z',
      },
    });
  });
  await page.goto('/plugins/amap.maps');
  await page.getByRole('button', { name: '地点检索', exact: true }).click();
  await page.getByLabel('关键词', { exact: true }).fill('合成地点');
  await page.getByRole('button', { name: '调用（Mock 模式）' }).click();
  await expect(page.getByText('合成地点检索完成')).toBeVisible();
  expect(calls).toBe(1);
});
test('expired session hides the directory and offers login', async ({ page }) => {
  await page.unroute('**/api/v1/plugins');
  await page.route('**/api/v1/plugins', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.goto('/plugins');
  await expect(
    page
      .getByRole('alert')
      .filter({ has: page.getByRole('heading', { name: '暂时无法读取目录' }) }),
  ).toBeVisible();
  await expect(page.locator('.plugin-tile')).toHaveCount(0);
});

test('offline hides the directory and reconnect reloads it', async ({ page, context }) => {
  await page.goto('/plugins');
  await expect(page.locator('.plugin-tile')).toHaveCount(10);
  await context.setOffline(true);
  await expect(page.locator('.plugin-tile')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.locator('.plugin-tile')).toHaveCount(10);
});
