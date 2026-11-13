import { describe, expect, it } from 'vitest';
import { inlineParts, messageBlocks } from './message-format';

describe('safe chat message formatting', () => {
  it('preserves paragraphs and separates ordered and unordered lists', () => {
    expect(messageBlocks('先确定目标。\n\n1. **目标**：学习\n2. 复盘\n\n- 笔记')).toEqual([
      { kind: 'paragraph', text: '先确定目标。' },
      { kind: 'list', ordered: true, items: ['**目标**：学习', '复盘'] },
      { kind: 'list', ordered: false, items: ['笔记'] },
    ]);
  });
  it('keeps unclosed streamed code as inert code', () => {
    expect(messageBlocks('```html\n<script>unsafe()</script>')).toEqual([
      { kind: 'code', language: 'html', text: '<script>unsafe()</script>' },
    ]);
  });
  it('never interprets raw HTML or javascript URLs', () => {
    const input = '<img src=x onerror=alert(1)> [click](javascript:alert(1))';
    expect(messageBlocks(input)).toEqual([{ kind: 'paragraph', text: input }]);
    expect(inlineParts(input)).toEqual([{ kind: 'text', text: input }]);
  });
  it('formats bold and inline code without treating escaped HTML as markup', () => {
    expect(inlineParts('用 **目标** 和 `<script>`')).toEqual([
      { kind: 'text', text: '用 ' },
      { kind: 'bold', text: '目标' },
      { kind: 'text', text: ' 和 ' },
      { kind: 'code', text: '<script>' },
    ]);
  });
  it('accepts incomplete streamed Markdown and multiline code', () => {
    expect(messageBlocks('**生成中')).toEqual([{ kind: 'paragraph', text: '**生成中' }]);
    expect(messageBlocks('```ts\nconst x = 1;\n```\n\n完成')).toHaveLength(2);
  });
});
