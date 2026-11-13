import { describe, expect, it } from 'vitest';
import {
  findSearchMatches,
  getLanguageLabel,
  normalizeLanguage,
  sliceTokenWithMatches,
  tokenize,
  tokenizeToLines,
} from './syntax';

describe('Syntax tokenizer and language labels', () => {
  it('normalizes languages and provides friendly labels', () => {
    expect(normalizeLanguage('  TSX  ')).toBe('tsx');
    expect(getLanguageLabel('ts')).toBe('TypeScript');
    expect(getLanguageLabel('py')).toBe('Python');
    expect(getLanguageLabel('sh')).toBe('Bash');
    expect(getLanguageLabel('sql')).toBe('SQL');
    expect(getLanguageLabel('json')).toBe('JSON');
    expect(getLanguageLabel('')).toBe('代码');
    expect(getLanguageLabel('unknownlang')).toBe('UNKNOWNLANG');
  });

  it('tokenizes TypeScript with keywords, types, strings, numbers and functions', () => {
    const code = 'const answer: number = 42;\nfunction solve() {\n  return answer;\n}';
    const tokens = tokenize(code, 'typescript');
    const types = tokens.map((t) => t.type);
    expect(types).toContain('keyword');
    expect(types).toContain('type');
    expect(types).toContain('number');
    expect(types).toContain('function');
    const reconstructed = tokens.map((t) => t.text).join('');
    expect(reconstructed).toBe(code);
  });

  it('tokenizes Python with keywords, strings, booleans and comments', () => {
    const code = '# calculate\ndef run():\n    valid = True\n    return "done"';
    const tokens = tokenize(code, 'python');
    expect(tokens.some((t) => t.type === 'comment' && t.text === '# calculate')).toBe(true);
    expect(tokens.some((t) => t.type === 'keyword' && t.text === 'def')).toBe(true);
    expect(tokens.some((t) => t.type === 'boolean' && t.text === 'True')).toBe(true);
    expect(tokens.some((t) => t.type === 'string' && t.text === '"done"')).toBe(true);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
  });

  it('tokenizes JSON with properties, values and punctuation', () => {
    const code = '{\n  "status": "ok",\n  "count": 10,\n  "ready": true\n}';
    const tokens = tokenize(code, 'json');
    expect(tokens.some((t) => t.type === 'property' && t.text === '"status"')).toBe(true);
    expect(tokens.some((t) => t.type === 'string' && t.text === '"ok"')).toBe(true);
    expect(tokens.some((t) => t.type === 'number' && t.text === '10')).toBe(true);
    expect(tokens.some((t) => t.type === 'boolean' && t.text === 'true')).toBe(true);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
  });

  it('tokenizes Bash with commands, variables and flags', () => {
    const code = 'pnpm install --filter @aven/web && echo $TARGET';
    const tokens = tokenize(code, 'bash');
    expect(tokens.some((t) => t.type === 'keyword' && t.text === 'pnpm')).toBe(true);
    expect(tokens.some((t) => t.type === 'type' && t.text === '--filter')).toBe(true);
    expect(tokens.some((t) => t.type === 'operator' && t.text === '&&')).toBe(true);
    expect(tokens.some((t) => t.type === 'variable' && t.text === '$TARGET')).toBe(true);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
  });

  it('tokenizes SQL case-insensitively', () => {
    const code = 'SELECT id, email FROM users WHERE active = TRUE;';
    const tokens = tokenize(code, 'sql');
    expect(tokens.some((t) => t.type === 'keyword' && t.text === 'SELECT')).toBe(true);
    expect(tokens.some((t) => t.type === 'keyword' && t.text === 'FROM')).toBe(true);
    expect(tokens.some((t) => t.type === 'boolean' && t.text === 'TRUE')).toBe(true);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
  });

  it('tokenizes Git Diff with additions, removals and metadata', () => {
    const code = '@@ -1,3 +1,3 @@\n-const old = 1;\n+const updated = 2;\n plain';
    const tokens = tokenize(code, 'diff');
    expect(tokens.some((t) => t.type === 'diff-meta')).toBe(true);
    expect(tokens.some((t) => t.type === 'diff-remove' && t.text === '-const old = 1;')).toBe(true);
    expect(tokens.some((t) => t.type === 'diff-add' && t.text === '+const updated = 2;')).toBe(true);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
  });

  it('handles streaming unfinished code gracefully without freezing', () => {
    const unfinished = 'const msg = "unclosed string\nconst num = 12';
    const tokens = tokenize(unfinished, 'ts');
    expect(tokens.map((t) => t.text).join('')).toBe(unfinished);
  });
});

describe('Line splitting', () => {
  it('splits tokens into lines and preserves blank lines', () => {
    const code = 'line1\n\nline3';
    const lines = tokenizeToLines(code, 'text');
    expect(lines.length).toBe(3);
    expect(lines[0]![0]!.text).toBe('line1');
    expect(lines[1]).toEqual([]);
    expect(lines[2]![0]!.text).toBe('line3');
  });

  it('reconstructs full multiline source exactly', () => {
    const code = 'function hello() {\n  // greeting\n  return "hi";\n}';
    const lines = tokenizeToLines(code, 'javascript');
    const reconstructed = lines.map((line) => line.map((t) => t.text).join('')).join('\n');
    expect(reconstructed).toBe(code);
  });
});

describe('Search matches inside code block', () => {
  it('finds search occurrences with global offset', () => {
    const source = 'const answer = 42; const anotherAnswer = 100;';
    const matches = findSearchMatches(source, 'answer', 10);
    expect(matches.length).toBe(2);
    expect(matches[0]).toEqual({ start: 6, end: 12, matchIndex: 10 });
    expect(matches[1]).toEqual({ start: 32, end: 38, matchIndex: 11 });
  });

  it('slices token text to embed search marks precisely', () => {
    const matches = [{ start: 6, end: 12, matchIndex: 5 }];
    const segments = sliceTokenWithMatches('answer', 6, matches, 5);
    expect(segments).toEqual([
      { text: 'answer', match: true, matchIndex: 5, isCurrent: true },
    ]);

    const nonMatching = sliceTokenWithMatches(' = 42;', 12, matches, 5);
    expect(nonMatching).toEqual([{ text: ' = 42;', match: false }]);
  });

  it('handles empty query without slicing', () => {
    const segments = sliceTokenWithMatches('const', 0, [], 0);
    expect(segments).toEqual([{ text: 'const', match: false }]);
  });
});
