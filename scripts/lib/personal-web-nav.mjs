// Navigation helpers for the Halo personal Web (ADR-018): Home → Profile / Chat screen stack,
// account sheet as the entry to 记忆与上下文 / 我的连接 / 通知. Shared by personal-web-*-verify.mjs.
const settle = (page) => page.waitForTimeout(400);

export async function openHome(page) {
  for (let i = 0; i < 3; i++) {
    const back = page
      .locator('.halo-screen[data-position="active"]')
      .getByRole('button', { name: '返回', exact: true });
    if (!(await back.count())) return;
    await back.first().click();
    await settle(page);
  }
}

export async function openChat(page) {
  const composer = page.getByLabel('向 AVEN 提问', { exact: true });
  if (await composer.isVisible()) return;
  await openHome(page);
  await page.getByRole('button', { name: '与 AVEN 对话', exact: true }).click();
  await composer.waitFor({ state: 'visible' });
  await settle(page);
}

export async function newChat(page) {
  await openHome(page);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await settle(page);
}

export async function openAccount(page) {
  await openHome(page);
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await page.getByRole('dialog').waitFor();
}

/** name: 记忆与上下文 | 我的连接 | 通知 (rows of the account sheet). */
export async function openPanel(page, name) {
  await openAccount(page);
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
  await page.getByRole('dialog').waitFor();
}
