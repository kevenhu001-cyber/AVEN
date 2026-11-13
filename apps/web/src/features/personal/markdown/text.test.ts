import { describe, expect, it } from 'vitest';
import {
  appendRevealChunks,
  countMarkdownHighlights,
  normalizeMath,
  rehypeTextLeaves,
} from './text';
import type { Root } from 'hast';

describe('Markdown search and math boundaries', () => {
  it('normalizes model math delimiters, preserving code and link destinations', () => {
    const source =
      '公式 \\(x^2\\)\n\\[y=2\\]\n`\\(literal\\)`\n\n```tex\n\\[raw\\]\n```\n\n[链接](https://example.test/\\(raw\\))';
    const normalized = normalizeMath(source);
    expect(normalized).toContain('$x^2$');
    expect(normalized).toContain('$$\ny=2\n$$');
    expect(normalized).toContain('`\\(literal\\)`');
    expect(normalized).toContain('```tex\n\\[raw\\]\n```');
    expect(normalized).toContain('https://example.test/\\(raw\\)');
  });

  it('leaves unfinished delimiters and escaped backslashes readable', () => {
    expect(normalizeMath('before \\(x')).toBe('before \\(x');
    expect(normalizeMath('\\\\(literal\\)')).toBe('\\\\(literal\\)');
  });

  it('counts visible text, code and link labels, excluding syntax and formulas', () => {
    const source =
      '# hello\n\n**hello** [hello](https://hello.test) `hello`\n\n```js\nhello\n```\n\n$hello$\n\n\\[hello\\]\n\n<!-- hello -->';
    expect(countMarkdownHighlights(source, 'hello')).toBe(5);
    expect(countMarkdownHighlights(source, '**')).toBe(0);
    expect(countMarkdownHighlights(source, 'https://')).toBe(0);
    expect(countMarkdownHighlights(source, '')).toBe(0);
  });

  it('wraps searchable leaves without modifying KaTeX input', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [{ type: 'text', value: 'hello hello' }],
        },
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-math', 'math-inline'] },
          children: [{ type: 'text', value: 'hello' }],
        },
      ],
    };
    rehypeTextLeaves({ query: 'hello', offset: 4 })(tree);
    expect(tree.children[0]).toMatchObject({
      children: [{ properties: { 'data-aven-text': true, 'data-search-offset': 4 } }],
    });
    expect(tree.children[1]).toMatchObject({ children: [{ type: 'text', value: 'hello' }] });
  });
});

describe('stream reveal chunks', () => {
  it('preserves spans on append and does not animate a rewritten prefix', () => {
    const initial = [{ text: '你', start: 0, fresh: true }];
    const next = appendRevealChunks(initial, '你好');
    expect(next[0]).toBe(initial[0]);
    expect(next[1]).toEqual({ text: '好', start: 1, fresh: true });
    expect(appendRevealChunks(next, '你好')).toBe(next);
    expect(appendRevealChunks(next, '替换')).toEqual([{ text: '替换', start: 0, fresh: false }]);
  });

  it('bounds span count without losing or duplicating text', () => {
    let chunks = [{ text: '', start: 0, fresh: true }];
    const source = '中文🙂'.repeat(100);
    for (let i = 1; i <= source.length; i++)
      chunks = appendRevealChunks(chunks, source.slice(0, i));
    expect(chunks.length).toBeLessThanOrEqual(32);
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source);
    expect(chunks[0]?.fresh).toBe(false);
  });

  it('keeps split surrogate pairs in the same DOM span', () => {
    const chunks = appendRevealChunks([{ text: '\uD83D', start: 0, fresh: true }], '🙂');
    expect(chunks).toEqual([{ text: '🙂', start: 0, fresh: true }]);
  });
});
