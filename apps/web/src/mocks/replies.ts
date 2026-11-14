/**
 * Canned assistant replies for the local mock API layer. Every reply is labelled as
 * simulated: it never comes from a real model and must never be presented as one.
 */
export function mockReply(input: string): string {
  const summary = input.trim().replace(/\s+/g, ' ').slice(0, 60);
  return [
    '【模拟回复】当前页面运行在本地模拟模式（`AVEN_WEB_MOCK=1`），不连接任何真实模型或数据库。',
    '',
    `已收到你的提问：**${summary}${input.trim().length > 60 ? '…' : ''}**`,
    '',
    '这段固定回复用于核对界面能力：',
    '',
    '- 流式渲染与打字光标',
    '- 行内代码 `mock-reply.ts` 与代码块',
    '- 复制 / 朗读 / 赞踩 / 重新生成动作',
    '- 会话历史与侧栏「最近对话」更新',
    '',
    '```text',
    'pnpm dev:web:mock   # 无 Docker/Postgres 的模拟启动',
    '```',
    '',
    '关闭模拟模式后，这里将由真实 Provider 的回答取代。',
  ].join('\n');
}

/** Split a reply into streamed chunks on natural boundaries. */
export function chunkReply(reply: string): string[] {
  const chunks: string[] = [];
  let rest = reply;
  while (rest.length > 0) {
    const size = rest.length > 160 ? 48 + (rest.length % 24) : rest.length;
    chunks.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  return chunks.length ? chunks : [''];
}
