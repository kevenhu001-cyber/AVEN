import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const prototype = new URL('../docs/design/prototypes/m1-07-v3/', import.meta.url);
const [checks, interactions, connectors] = await Promise.all([
  readFile(new URL('checks.js', prototype), 'utf8'),
  readFile(new URL('interaction-checks.js', prototype), 'utf8'),
  readFile(new URL('connector-checks.js', prototype), 'utf8'),
]);
const evidence = await mkdtemp(join(tmpdir(), 'aven-design-'));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
const results = [];
try {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = [];
    let legacy;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.text().startsWith('{"prototype"')) legacy = JSON.parse(message.text());
    });
    await page.goto(new URL('index.html', prototype).href);
    await expect(page).toHaveTitle('AVEN · 对话与连接');
    await expect(page.locator('#prompt')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(evidence, `chat-${width}.png`), fullPage: true });
    await page.addScriptTag({ content: connectors });
    const connector = await page.evaluate(() => window.avenConnectorChecks);
    await page.addScriptTag({ content: 'actions.demo();' });
    await page.addScriptTag({ content: checks });
    await page.addScriptTag({ content: interactions });
    const interaction = await page.evaluate(() => window.avenInteractionChecks);
    const result = { width, legacy, interaction, connector, errors };
    results.push(result);
    if (
      !legacy ||
      legacy.failures.length ||
      interaction.failures.length ||
      connector.failures.length ||
      errors.length
    )
      throw new Error(`Prototype checks failed: ${JSON.stringify(result)}`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(new URL('index.html', prototype).href);
  await page.getByRole('button', { name: '授权', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '连接 Gmail' })).toBeVisible();
  await page.getByRole('button', { name: '同意并继续演示', exact: true }).click();
  await expect(page.locator('.connector-copy')).toContainText('已连接 · 设计模拟');
  await page.getByRole('button', { name: '断开', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '断开这个连接？' })).toBeVisible();
  await page.getByRole('button', { name: '确认断开', exact: true }).click();
  await expect(page.getByRole('button', { name: '授权', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新对话', exact: true }).first().click();
  await page.locator('#prompt').fill('第一行');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('第二行');
  await expect(page.locator('#prompt')).toHaveValue('第一行\n第二行');
  await page.getByRole('button', { name: '添加插件与上下文' }).click();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: '管理插件与自定义 MCP' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tools-toggle')).toBeFocused();
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.locator('#mcp-url').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '登记并使用此 MCP' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '关闭面板' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '登记并使用此 MCP' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '插件', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 960 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(page.locator('#collapse')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#profile')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#open-sidebar')).toBeFocused();
  console.log(JSON.stringify({ results, keyboard: 'passed', evidence }, null, 2));
} finally {
  await browser.close();
}
