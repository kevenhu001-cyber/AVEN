// Navigation helpers for the route-based personal Web.
// Every destination is an independent page, so helpers navigate by URL and wait
// for the page heading instead of opening an in-page screen or sheet.
const settle = (page) => page.waitForTimeout(400);

const panelRoutes = {
  记忆与上下文: { path: '/memory', heading: '记忆与上下文' },
  我的连接: { path: '/connections', heading: '我的连接' },
  通知: { path: '/notifications', heading: '通知' },
};

export async function openHome(page) {
  await page.goto('/');
  await page.getByLabel('向 AVEN 提问', { exact: true }).waitFor({ state: 'visible' });
  await settle(page);
}

export async function openChat(page) {
  await page.goto('/chat');
  await page.getByLabel('向 AVEN 提问', { exact: true }).waitFor({ state: 'visible' });
  await settle(page);
}

/** Search rendered reply text; Markdown syntax and formula internals are excluded. */
export async function findInChat(page, query) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '在聊天中查找', exact: true }).click();
  await page.getByPlaceholder('在聊天中查找', { exact: true }).fill(query);
}

export async function newChat(page) {
  await openHome(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
  await page.getByLabel('向 AVEN 提问', { exact: true }).waitFor({ state: 'visible' });
  await settle(page);
}

export async function openAccount(page) {
  await page.goto('/account');
  await page.getByRole('heading', { name: '账号与设置', exact: true }).waitFor();
  await settle(page);
}

/** name: 记忆与上下文 | 我的连接 | 通知. */
export async function openPanel(page, name) {
  const target = panelRoutes[name];
  if (!target) throw new Error(`Unknown panel: ${name}`);
  await page.goto(target.path);
  await page.getByRole('heading', { name: target.heading, exact: true }).waitFor();
  await settle(page);
}

/** Independent connector catalog. */
export async function openPluginDirectory(page) {
  await page.goto('/apps');
  await page.getByRole('heading', { name: '连接应用', exact: true }).waitFor();
  await settle(page);
}

export async function openConnectorDialog(page) {
  await page.getByRole('button', { name: '连接器', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '连接应用' });
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}
