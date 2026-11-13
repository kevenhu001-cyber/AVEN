import { expect, test, type Page } from '@playwright/test';
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

// Byte-stream fixture: unlike route.fulfill, this exercises incremental fetch/SSE parsing.
async function markdownStream(page: Page, chunks: string[], terminal = 'turn.completed') {
  const runId = '11111111-1111-4111-8111-111111111111';
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: me }));
  await page.route('**/api/v1/open-connector', (route) => route.fulfill({ json: [] }));
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
  await page.addInitScript(
    ({ runId, chunks, terminal }) => {
      const fetcher = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        if (!String(input).endsWith(`/runs/${runId}/events`)) return fetcher(input, init);
        const encoder = new TextEncoder();
        const frames = [
          { type: 'turn.started' },
          ...chunks.map((text) => ({ type: 'message.delta', text })),
          ...(terminal ? [{ type: terminal }] : []),
        ];
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let index = 0;
            let stopped = false;
            const abort = () => {
              stopped = true;
              controller.error(new DOMException('Aborted', 'AbortError'));
            };
            init?.signal?.addEventListener('abort', abort, { once: true });
            function next() {
              if (stopped) return;
              const frame = frames[index++];
              if (!frame) {
                if (terminal) {
                  init?.signal?.removeEventListener('abort', abort);
                  controller.close();
                }
                return;
              }
              const data = {
                schema_version: 1,
                run_id: runId,
                sequence: index,
                timestamp: new Date().toISOString(),
                ...frame,
              };
              controller.enqueue(
                encoder.encode(
                  `id: ${index}\nevent: ${frame.type}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
              window.setTimeout(next, 180);
            }
            next();
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      };
    },
    { runId, chunks, terminal },
  );
}

test('streamed Markdown renders math, code, safe links and searchable text', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  const chunks = [
    '# 研究笔记\n\n**重点** 与 [来源](https://example.test/reference)\n\n- 第一项\n- 第二项\n\n公式 \\(x^',
    '2\\)\n\n\\[\\frac{1}{2}\\]\n\n```ts\nconst answer = ',
    '42;\n```\n\n| 项目 | 说明 |\n| --- | --- |\n| 结果 | 重点 |\n\n![远程图](https://example.test/tracker.png)\n\n[危险链接](javascript:alert(1))\n\n<script>UNTRUSTED_SCRIPT</script>',
  ];
  let remoteLoads = 0;
  await page.route('https://example.test/**', (route) => {
    remoteLoads++;
    return route.abort();
  });
  await markdownStream(page, chunks);
  await page.goto('/chat');
  await page.getByLabel('向 AVEN 提问', { exact: true }).fill('请输出研究笔记');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const bubble = page.locator('.assistant-bubble');
  await expect(bubble.getByRole('heading', { name: '研究笔记' })).toBeVisible();
  await expect(bubble).toHaveAttribute('data-streaming', 'true');
  await expect(bubble.locator('.markdown-reveal').first()).toHaveCSS(
    'animation-name',
    'markdown-reveal',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(bubble.locator('.markdown-reveal').first()).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByText('回复完成', { exact: true })).toBeVisible();
  await expect(bubble.locator('.katex')).toHaveCount(2);
  await expect(bubble.getByRole('table')).toBeVisible();
  await expect(bubble.locator('li')).toHaveCount(2);
  await expect(bubble.getByRole('link', { name: '来源' })).toHaveAttribute(
    'href',
    'https://example.test/reference',
  );
  await expect(bubble.getByRole('link', { name: '危险链接' })).toHaveCount(0);
  await expect(bubble.locator('img, script')).toHaveCount(0);
  await expect(bubble).not.toContainText('UNTRUSTED_SCRIPT');
  expect(remoteLoads).toBe(0);
  await bubble.getByRole('button', { name: '复制代码', exact: true }).click();
  await expect(bubble.getByRole('button', { name: '已复制代码', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const answer = 42;');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '在聊天中查找', exact: true }).click();
  await page.getByPlaceholder('在聊天中查找').fill('重点');
  await expect(bubble.locator('mark')).toHaveCount(2);
  await expect(bubble.locator('mark[data-current="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: '下一个', exact: true }).click();
  await expect(bubble.locator('mark[data-current="true"]')).toHaveAttribute('data-match', '1');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByPlaceholder('在聊天中查找').fill('');
  await expect(bubble.locator('.markdown-reveal')).toHaveCount(0);
});

test('failed streamed replies clear rendered Markdown', async ({ page, context }) => {
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  await markdownStream(page, ['**待清除正文**'], 'turn.failed');
  await page.goto('/chat');
  await page.getByRole('button', { name: '帮我整理今天的想法', exact: true }).click();
  await expect(page.getByText('本次回复未完成', { exact: true })).toBeVisible();
  await expect(page.locator('.assistant-bubble')).toHaveCount(0);
});

test('cancel preserves incomplete code and invalid math without leaving generation active', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  await markdownStream(page, ['错误公式 $\\unknownmacro{x}$\n\n```js\nconst partial = 1;'], '');
  await page.route('**/api/v1/agent/runs/*/cancel', (route) =>
    route.fulfill({
      json: {
        runId: '11111111-1111-4111-8111-111111111111',
        status: 'cancelled',
      },
    }),
  );
  await page.goto('/chat');
  await page.getByRole('button', { name: '帮我整理今天的想法', exact: true }).click();
  const bubble = page.locator('.assistant-bubble');
  await expect(bubble.locator('pre')).toContainText('const partial = 1;');
  await expect(bubble).toContainText('unknownmacro');
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await expect(page.getByText('已停止', { exact: true })).toBeVisible();
  await expect(bubble).toHaveAttribute('data-streaming', 'false');
  await expect(bubble.getByRole('button', { name: '复制代码', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toHaveCount(0);
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

test.describe('shell navigation', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('sidebar collapses, remembers the choice, and starts a new conversation', async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: me }));
    await page.goto('/');
    const sidebar = page.locator('.shell-sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await expect(page.getByRole('navigation', { name: '对话', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '我的空间', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await expect(page.locator('.shell-sidebar .shell-nav-label').first()).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('aven.shell.sidebar'))).toBe('collapsed');

    await page.reload();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');

    await page.getByRole('button', { name: '开启新对话', exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByLabel('向 AVEN 提问', { exact: true })).toBeVisible();
  });

  test('mobile drawer opens from the top bar, closes on Escape and after navigating', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: me }));
    await page.goto('/');
    await expect(page.locator('.shell-sidebar')).toBeHidden();

    await page.getByRole('button', { name: '更多导航', exact: true }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: '我的空间', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('link', { name: '记忆与上下文', exact: true }).click();
    await expect(page).toHaveURL(/\/memory$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('mermaid fences render a diagram and switch back to source', async ({ page, context }) => {
  await context.addCookies([
    { name: 'aven_csrf', value: 'synthetic-csrf', url: 'http://127.0.0.1:3100' },
  ]);
  await markdownStream(page, ['```mermaid\n', 'graph TD;\n  A[开始] --> B[结束];\n', '```']);
  await page.goto('/chat');
  await page.getByLabel('向 AVEN 提问', { exact: true }).fill('画个流程图');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('回复完成', { exact: true })).toBeVisible();
  const bubble = page.locator('.assistant-bubble');
  await expect(bubble.locator('.markdown-mermaid-diagram svg')).toBeVisible();
  await expect(bubble.getByRole('group', { name: 'Mermaid 显示方式' })).toBeVisible();

  await bubble.getByRole('button', { name: '代码', exact: true }).click();
  await expect(bubble.locator('.markdown-code-pre')).toContainText('graph TD');
  await expect(bubble.locator('.markdown-mermaid-diagram')).toHaveCount(0);

  await bubble.getByRole('button', { name: '图表', exact: true }).click();
  await expect(bubble.locator('.markdown-mermaid-diagram svg')).toBeVisible();
});
