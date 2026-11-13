import { expect, test } from '@playwright/test';
test('non-administrator cannot see configuration fields', async ({ page }) => {
  await page.route('**/api/v1/admin/configurations', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.goto('/admin');
  await expect(page.getByText('当前账号没有平台管理员权限。')).toBeVisible();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveCount(0);
});
test('administrator can save a model without retaining the key', async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  let saved = false;
  await page.route('**/api/v1/admin/configurations', (route) =>
    route.fulfill({
      json: {
        connectorEnvironmentConfigured: true,
        data: saved
          ? [
              {
                kind: 'model',
                baseUrl: 'https://synthetic.example.test/v1',
                model: 'synthetic-model',
                version: 1,
                updatedAt: '2026-11-13T00:00:00.000Z',
              },
            ]
          : [],
      },
    }),
  );
  await page.route('**/api/v1/admin/configurations/model', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    expect(route.request().postDataJSON()).toEqual({
      baseUrl: 'https://synthetic.example.test/v1',
      model: 'synthetic-model',
      apiKey: 'synthetic-key',
      expectedVersion: 0,
    });
    saved = true;
    await route.fulfill({ json: { saved: true } });
  });
  await page.goto('/admin');
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '模型 · OpenAI-compatible' }) });
  await section.getByLabel('API 地址').fill('https://synthetic.example.test/v1');
  await section.getByLabel('模型名称').fill('synthetic-model');
  await section.getByLabel('API Key', { exact: true }).fill('synthetic-key');
  await section.getByRole('button', { name: '保存配置' }).click();
  await expect(section.getByText(/已保存 · 版本 1/)).toBeVisible();
  await expect(section.getByLabel('API Key', { exact: true })).toHaveValue('');
  expect(saved).toBe(true);
  await expect(page.getByText(/已配置服务器 Open Connector 网关密钥/)).toBeVisible();
  await expect(page).toHaveTitle('AVEN · 对话与连接');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('admin-model.png'), fullPage: true });
});
test('configuration conflict requires a fresh read and clears the submitted key', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  await page.route('**/api/v1/admin/configurations', (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route('**/api/v1/admin/configurations/model', (route) =>
    route.fulfill({ status: 409, body: '{}' }),
  );
  await page.goto('/admin');
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '模型 · OpenAI-compatible' }) });
  await section.getByLabel('API 地址').fill('https://synthetic.example.test/v1');
  await section.getByLabel('模型名称').fill('synthetic-model');
  await section.getByLabel('API Key', { exact: true }).fill('synthetic-key');
  await section.getByRole('button', { name: '保存配置' }).click();
  await expect(section.getByText('版本已变化，请刷新后重新填写。')).toBeVisible();
  await expect(section.getByLabel('API Key', { exact: true })).toHaveValue('');
});
test('missing gateway never becomes a simulated successful connection', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  await page.route('**/api/v1/open-connector', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/open-connector/gmail/connect', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.goto('/connectors');
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Gmail', exact: true }) });
  await section.getByRole('button', { name: '发起授权' }).click();
  await expect(page.getByText(/网关配置未就绪/)).toBeVisible();
  await expect(page.getByRole('link', { name: '确认前往授权页面' })).toHaveCount(0);
  await expect(section.getByText('尚未连接')).toBeVisible();
  const logo = section.locator('img[src="/connector-icons/gmail.svg"]');
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
});
