import { expect, test } from '@playwright/test';

const basePlugin = {
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

const gmailPlugin = {
  ...basePlugin,
  id: 'gmail.mail',
  name: 'Gmail',
  description: '读取与发送邮件',
  category: 'mail',
  authType: 'oauth2',
  actions: [
    {
      ...basePlugin.actions[0],
      name: 'list_messages',
      title: '读取邮件',
      requiredPermissions: ['plugin:read:mail'],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/plugins', (route) =>
    route.fulfill({ json: { plugins: [basePlugin, gmailPlugin], total: 2 } }),
  );
});

test('catalog shows real credential state and never runs simulated actions', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/apps');
  await expect(page.getByRole('heading', { name: '连接应用', exact: true })).toBeVisible();
  await expect(page.locator('.apps-item')).toHaveCount(2);
  await expect(page.getByText('缺少凭据', { exact: true }).first()).toBeVisible();

  await page.locator('.apps-main').filter({ hasText: '高德地图' }).click();
  await expect(page.getByRole('button', { name: '地点检索', exact: true })).toBeDisabled();
  await expect(page.getByText('未配置真实凭据，动作暂不可用。', { exact: false })).toBeVisible();

  await expect(page.getByRole('link', { name: '授权 Gmail' })).toHaveAttribute(
    'href',
    '/connectors',
  );

  await page.getByLabel('搜索应用和技能').fill('Gmail');
  await expect(page.locator('.apps-item')).toHaveCount(1);
  await page.getByLabel('搜索应用和技能').fill('不存在的服务');
  await expect(page.getByRole('heading', { name: '没有匹配的应用' })).toBeVisible();
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(page.locator('.apps-item')).toHaveCount(2);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('apps.png'), fullPage: true });
});

test('detail invokes a configured connector with live mode', async ({ page, context }) => {
  await page.unroute('**/api/v1/plugins');
  await page.route('**/api/v1/plugins', (route) =>
    route.fulfill({
      json: {
        plugins: [{ ...basePlugin, credentialStatus: 'configured' }],
        total: 1,
      },
    }),
  );
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  let calls = 0;
  await page.route('**/api/v1/plugins/amap.maps/invoke', async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({
      action: 'search_poi',
      input: { query: '合成地点' },
      allowLive: true,
    });
    await route.fulfill({
      json: {
        invocationId: '11111111-1111-4111-8111-111111111111',
        pluginId: 'amap.maps',
        action: 'search_poi',
        providerMode: 'live',
        summary: '合成地点检索完成',
        data: {},
        widgets: [],
        auditRef: 'synthetic-audit',
        executedAt: '2026-11-13T00:00:00.000Z',
      },
    });
  });
  await page.goto('/apps/amap.maps');
  await expect(page.getByRole('heading', { name: '高德地图', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '地点检索', exact: true }).click();
  await page.getByLabel('关键词', { exact: true }).fill('合成地点');
  await page.getByRole('button', { name: '调用', exact: true }).click();
  await expect(page.getByText('合成地点检索完成')).toBeVisible();
  await expect(page.getByText('实时数据', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test('catalog failure is shown without fabricated rows', async ({ page }) => {
  await page.unroute('**/api/v1/plugins');
  await page.route('**/api/v1/plugins', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.goto('/apps');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.apps-item')).toHaveCount(0);
});
