import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock-provider.js';
import { mockChatReply } from './mock-chat-reply.js';

describe('deterministic chat examples', () => {
  it('offers readable planning steps while clearly describing the mock boundary', () => {
    const reply = mockChatReply([{ role: 'user', content: '帮我安排今天的学习' }]);
    expect(reply).toContain('1. **明确目标**');
    expect(reply).toContain('Mock');
    expect(reply).toContain('不会创建日历');
  });
  it('does not claim to have connected or read an external mailbox', () => {
    const reply = mockChatReply([{ role: 'user', content: '连接 outlook' }]);
    expect(reply).toContain('真实 OAuth 尚未接通');
    expect(reply).toContain('没有登录邮箱');
  });
  it('does not use retrieved context as the prompt or echo private data', () => {
    const reply = mockChatReply([
      { role: 'user', content: '你好' },
      { role: 'user', name: 'personal_context', content: 'private-marker 连接 outlook' },
    ]);
    expect(reply).toContain('你好');
    expect(reply).not.toContain('private-marker');
    expect(reply).not.toContain('OAuth');
  });
  it('keeps unknown requests honest instead of hallucinating an answer', () => {
    expect(mockChatReply([{ role: 'user', content: '任意未知问题' }])).toContain(
      '不能像真实模型一样回答',
    );
  });
  it('preserves explicit fixture output overrides', async () => {
    const provider = new MockProvider({ text: 'explicit-fixture' });
    const messages = [{ role: 'user' as const, content: '安排学习' }];
    expect((await provider.generateText({ messages })).text).toBe('explicit-fixture');
    let text = '';
    for await (const event of provider.streamText({ messages }))
      if (event.type === 'text_delta') text += event.text;
    expect(text).toBe('explicit-fixture');
  });
});
