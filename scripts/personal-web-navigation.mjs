// Shared selectors for the full-page workspace and its mobile navigation drawer.
export async function closePersonalPanel(page) {
  const close = page.getByRole('button', { name: '关闭面板', exact: true });
  if (await close.isVisible()) await close.click();
  else await page.getByRole('button', { name: '回到对话', exact: true }).click();
}
export async function openPersonalPanel(page, name) {
  let button = page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
  if (!(await button.isVisible())) {
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    button = page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
  }
  await button.click();
}
