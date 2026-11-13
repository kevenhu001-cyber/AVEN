export type TokenType =
  | 'keyword'
  | 'type'
  | 'function'
  | 'string'
  | 'number'
  | 'boolean'
  | 'comment'
  | 'operator'
  | 'punctuation'
  | 'property'
  | 'tag'
  | 'variable'
  | 'diff-add'
  | 'diff-remove'
  | 'diff-meta'
  | 'plain';

export type SyntaxToken = {
  type: TokenType;
  text: string;
};

export type LineToken = SyntaxToken;

export type SearchMatch = {
  start: number;
  end: number;
  matchIndex: number;
};

export type TokenSegment = {
  text: string;
  match: boolean;
  matchIndex?: number;
  isCurrent?: boolean;
};

type Rule = {
  type: TokenType;
  regex: RegExp;
};

const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  json: 'JSON',
  jsonc: 'JSON',
  sh: 'Bash',
  bash: 'Bash',
  zsh: 'Bash',
  shell: 'Shell',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  sql: 'SQL',
  pgsql: 'PostgreSQL',
  mysql: 'MySQL',
  html: 'HTML',
  xml: 'XML',
  svg: 'SVG',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  md: 'Markdown',
  markdown: 'Markdown',
  yaml: 'YAML',
  yml: 'YAML',
  rs: 'Rust',
  rust: 'Rust',
  go: 'Go',
  golang: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  kotlin: 'Kotlin',
  c: 'C',
  cpp: 'C++',
  cxx: 'C++',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  mermaid: 'Mermaid',
};

export function normalizeLanguage(lang: string): string {
  return lang.trim().toLowerCase();
}

export function getLanguageLabel(lang: string): string {
  const normalized = normalizeLanguage(lang);
  if (!normalized) return '代码';
  return LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
}

// Rules for JavaScript / TypeScript / TSX / JSX
const JS_TS_RULES: Rule[] = [
  { type: 'comment', regex: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
  {
    type: 'string',
    regex: /`([^`\\]|\\.)*`|"(?:[^"\n\\]|\\.)*(?:"|$)|'(?:[^'\n\\]|\\.)*(?:'|$)/y,
  },
  { type: 'number', regex: /\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
  { type: 'boolean', regex: /\b(true|false|null|undefined|NaN|Infinity)\b/y },
  {
    type: 'keyword',
    regex:
      /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|default|new|this|typeof|instanceof|void|delete|throw|try|catch|finally|class|extends|super|import|export|from|as|async|await|yield|in|of)\b/y,
  },
  {
    type: 'type',
    regex:
      /\b(type|interface|enum|implements|declare|readonly|public|private|protected|static|abstract|override|keyof|infer|never|any|unknown|string|number|boolean|symbol|bigint|object|Record|Array|Promise|Partial|Required|Readonly|Pick|Omit)\b/y,
  },
  { type: 'function', regex: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/y },
  { type: 'property', regex: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/y },
  {
    type: 'operator',
    regex: /=>|\.\.\.|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\+\+|--|[+\-*/%&|^~!=<>?:.]/y,
  },
  { type: 'punctuation', regex: /[{}[\]();,]/y },
  { type: 'plain', regex: /[a-zA-Z_$][a-zA-Z0-9_$]*/y },
];

// Rules for Python
const PYTHON_RULES: Rule[] = [
  { type: 'comment', regex: /#[^\n]*/y },
  {
    type: 'string',
    regex:
      /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|r?"(?:[^"\n\\]|\\.)*(?:"|$)|r?'(?:[^'\n\\]|\\.)*(?:'|$)|f"(?:[^"\n\\]|\\.)*(?:"|$)|f'(?:[^'\n\\]|\\.)*(?:'|$)/y,
  },
  { type: 'number', regex: /\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
  { type: 'boolean', regex: /\b(True|False|None)\b/y },
  {
    type: 'keyword',
    regex:
      /\b(def|class|return|if|elif|else|for|while|break|continue|pass|import|from|as|try|except|finally|raise|with|yield|lambda|in|is|not|and|or|global|nonlocal|async|await)\b/y,
  },
  {
    type: 'type',
    regex:
      /\b(int|str|float|bool|list|dict|set|tuple|bytes|self|cls|Any|Optional|Union|List|Dict|Tuple|Set)\b/y,
  },
  { type: 'function', regex: /\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/y },
  { type: 'variable', regex: /@[a-zA-Z_][a-zA-Z0-9_.]*/y },
  {
    type: 'operator',
    regex: /\*\*|\/\/|<=|>=|==|!=|\+=|-=|\*=|\/=|->|[+\-*/%&|^~!=<>@:]/y,
  },
  { type: 'punctuation', regex: /[{}[\]();,]/y },
  { type: 'plain', regex: /[a-zA-Z_][a-zA-Z0-9_]*/y },
];

// Rules for JSON
const JSON_RULES: Rule[] = [
  { type: 'property', regex: /"(?:[^"\n\\]|\\.)*"(?=\s*:)/y },
  { type: 'string', regex: /"(?:[^"\n\\]|\\.)*(?:"|$)/y },
  { type: 'number', regex: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
  { type: 'boolean', regex: /\b(true|false|null)\b/y },
  { type: 'punctuation', regex: /[{}[\],:]/y },
];

// Rules for Bash / Shell
const BASH_RULES: Rule[] = [
  { type: 'comment', regex: /#[^\n]*/y },
  {
    type: 'string',
    regex: /"(?:[^"\n\\]|\\.)*(?:"|$)|'(?:[^'\n\\]|\\.)*(?:'|$)/y,
  },
  { type: 'variable', regex: /\$[a-zA-Z_0-9]+|\$\{[^}]+\}/y },
  { type: 'type', regex: /--[a-zA-Z0-9-]+|-[a-zA-Z0-9]+/y },
  {
    type: 'keyword',
    regex:
      /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|echo|cd|ls|mkdir|rm|cp|mv|git|curl|pnpm|npm|yarn|node|docker|export|set|unset|source|local|chmod|chown|sudo)\b/y,
  },
  { type: 'operator', regex: /&&|\|\||>>|>|<|\||;|&/y },
  { type: 'punctuation', regex: /[{}[\]();]/y },
  { type: 'plain', regex: /[a-zA-Z0-9_./-]+/y },
];

// Rules for SQL
const SQL_RULES: Rule[] = [
  { type: 'comment', regex: /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
  {
    type: 'string',
    regex: /'(?:[^'\n\\]|\\.)*(?:'|$)|"(?:[^"\n\\]|\\.)*(?:"|$)/y,
  },
  { type: 'number', regex: /\b\d+(?:\.\d+)?\b/y },
  { type: 'boolean', regex: /\b(TRUE|FALSE|NULL)\b/iy },
  {
    type: 'keyword',
    regex:
      /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION|ALL|CREATE|TABLE|ALTER|DROP|INDEX|VIEW|SCHEMA|DATABASE|AS|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|IS|DISTINCT|CASE|WHEN|THEN|ELSE|END|RETURNING|CONFLICT|DO|NOTHING|FORCE|RLS|POLICY)\b/iy,
  },
  {
    type: 'type',
    regex:
      /\b(INT|INTEGER|BIGINT|VARCHAR|TEXT|BOOLEAN|TIMESTAMP|TIMESTAMPTZ|DATE|TIME|JSON|JSONB|UUID|NUMERIC|FLOAT|REAL|SERIAL)\b/iy,
  },
  { type: 'function', regex: /\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/y },
  { type: 'operator', regex: /<=|>=|!=|<>|=|<|>|\+|-|\*|\/|%/y },
  { type: 'punctuation', regex: /[(),;.]/y },
  { type: 'plain', regex: /[a-zA-Z_][a-zA-Z0-9_]*/y },
];

// Rules for HTML / XML
const HTML_RULES: Rule[] = [
  { type: 'comment', regex: /<!--[\s\S]*?(?:-->|$)/y },
  { type: 'tag', regex: /<\/?[a-zA-Z0-9-]+|\/?>/y },
  { type: 'property', regex: /[a-zA-Z0-9-]+(?=\s*=)/y },
  {
    type: 'string',
    regex: /"(?:[^"\n\\]|\\.)*(?:"|$)|'(?:[^'\n\\]|\\.)*(?:'|$)/y,
  },
  { type: 'punctuation', regex: /[=]/y },
  { type: 'plain', regex: /[^<>"'=]+/y },
];

// Rules for CSS / SCSS
const CSS_RULES: Rule[] = [
  { type: 'comment', regex: /\/\*[\s\S]*?(?:\*\/|$)/y },
  {
    type: 'keyword',
    regex: /@(media|keyframes|import|layer|font-face|supports)\b|!important/y,
  },
  { type: 'property', regex: /[a-zA-Z-][a-zA-Z0-9-]*(?=\s*:)/y },
  {
    type: 'string',
    regex: /"(?:[^"\n\\]|\\.)*(?:"|$)|'(?:[^'\n\\]|\\.)*(?:'|$)/y,
  },
  {
    type: 'number',
    regex: /#(?:[0-9a-fA-F]{3,8})\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|dvh|s|ms|deg)?\b/y,
  },
  { type: 'punctuation', regex: /[{}[\]();:,]/y },
  { type: 'plain', regex: /[a-zA-Z0-9_-]+/y },
];

// Generic / fallback rules
const GENERIC_RULES: Rule[] = [
  { type: 'comment', regex: /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
  {
    type: 'string',
    regex: /"(?:[^"\n\\]|\\.)*(?:"|$)|'(?:[^'\n\\]|\\.)*(?:'|$)|`([^`\\]|\\.)*(?:`|$)/y,
  },
  { type: 'number', regex: /\b\d+(?:\.\d+)?\b/y },
  { type: 'boolean', regex: /\b(true|false|null|True|False|None)\b/y },
  { type: 'punctuation', regex: /[{}[\]();,]/y },
  { type: 'operator', regex: /[=+\-*/%&|^~!=<>]/y },
  { type: 'plain', regex: /[a-zA-Z_][a-zA-Z0-9_]*/y },
];

// Rules for Git Diff
const DIFF_RULES: Rule[] = [
  { type: 'diff-meta', regex: /@@[^\n]*@@[^\n]*/y },
  { type: 'comment', regex: /(?:diff\s+--git|index\s+[a-f0-9]|---|\+\+\+)[^\n]*/y },
  { type: 'diff-add', regex: /\+[^\n]*/y },
  { type: 'diff-remove', regex: /-[^\n]*/y },
  { type: 'plain', regex: /[^\n]+/y },
];

function getRules(language: string): Rule[] {
  const norm = normalizeLanguage(language);
  if (norm === 'diff') return DIFF_RULES;
  if (['ts', 'typescript', 'js', 'javascript', 'jsx', 'tsx'].includes(norm)) return JS_TS_RULES;
  if (['py', 'python'].includes(norm)) return PYTHON_RULES;
  if (['json', 'jsonc'].includes(norm)) return JSON_RULES;
  if (['sh', 'bash', 'zsh', 'shell', 'powershell', 'ps1'].includes(norm)) return BASH_RULES;
  if (['sql', 'pgsql', 'mysql'].includes(norm)) return SQL_RULES;
  if (['html', 'xml', 'svg'].includes(norm)) return HTML_RULES;
  if (['css', 'scss', 'less'].includes(norm)) return CSS_RULES;
  return GENERIC_RULES;
}

export function tokenize(code: string, language: string): SyntaxToken[] {
  if (!code) return [];
  const rules = getRules(language);
  const tokens: SyntaxToken[] = [];
  let cursor = 0;
  const len = code.length;
  const whitespaceRegex = /\s+/y;
  const fallbackRegex = /[^\s]+/y;

  while (cursor < len) {
    whitespaceRegex.lastIndex = cursor;
    const wsMatch = whitespaceRegex.exec(code);
    if (wsMatch) {
      tokens.push({ type: 'plain', text: wsMatch[0] });
      cursor += wsMatch[0].length;
      if (cursor >= len) break;
    }

    let matched = false;
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r]!;
      rule.regex.lastIndex = cursor;
      const match = rule.regex.exec(code);
      if (match) {
        tokens.push({ type: rule.type, text: match[0] });
        cursor += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      fallbackRegex.lastIndex = cursor;
      const fbMatch = fallbackRegex.exec(code);
      if (fbMatch) {
        tokens.push({ type: 'plain', text: fbMatch[0] });
        cursor += fbMatch[0].length;
      } else {
        tokens.push({ type: 'plain', text: code[cursor]! });
        cursor++;
      }
    }
  }

  return tokens;
}

export function tokenizeToLines(code: string, language: string): LineToken[][] {
  const tokens = tokenize(code, language);
  const lines: LineToken[][] = [[]];

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (!token.text.includes('\n')) {
      lines[lines.length - 1]!.push(token);
      continue;
    }
    const parts = token.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      const part = parts[i]!;
      if (part) {
        lines[lines.length - 1]!.push({ type: token.type, text: part });
      }
    }
  }

  return lines;
}

export function findSearchMatches(
  source: string,
  query: string,
  baseOffset: number,
): SearchMatch[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  if (!needle) return [];
  const matches: SearchMatch[] = [];
  const lower = source.toLocaleLowerCase('zh-CN');
  let from = 0;
  let matchIdx = 0;

  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    matches.push({
      start: at,
      end: at + needle.length,
      matchIndex: baseOffset + matchIdx,
    });
    matchIdx++;
    from = at + needle.length;
  }

  return matches;
}

export function sliceTokenWithMatches(
  tokenText: string,
  tokenStart: number,
  matches: SearchMatch[],
  current: number,
): TokenSegment[] {
  if (matches.length === 0) {
    return [{ text: tokenText, match: false }];
  }

  const tokenEnd = tokenStart + tokenText.length;
  const segments: TokenSegment[] = [];
  let pos = tokenStart;

  for (let m = 0; m < matches.length; m++) {
    const match = matches[m]!;
    if (match.end <= tokenStart || match.start >= tokenEnd) continue;

    if (match.start > pos) {
      segments.push({
        text: tokenText.slice(pos - tokenStart, match.start - tokenStart),
        match: false,
      });
      pos = match.start;
    }

    const matchStartInToken = Math.max(pos, match.start);
    const matchEndInToken = Math.min(tokenEnd, match.end);

    if (matchEndInToken > matchStartInToken) {
      segments.push({
        text: tokenText.slice(matchStartInToken - tokenStart, matchEndInToken - tokenStart),
        match: true,
        matchIndex: match.matchIndex,
        isCurrent: match.matchIndex === current,
      });
      pos = matchEndInToken;
    }
  }

  if (pos < tokenEnd) {
    segments.push({
      text: tokenText.slice(pos - tokenStart),
      match: false,
    });
  }

  return segments;
}
