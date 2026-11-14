/** Pure text helpers for Halo chat rendering: inline code, in-chat search and highlight. */
export type TextSegment = { text: string; code: boolean; match: boolean; matchIndex?: number };

/** Split `text` into plain and `inline code` segments. Unclosed backticks stay plain text. */
export function splitInlineCode(text: string): { text: string; code: boolean }[] {
  const segments: { text: string; code: boolean }[] = [];
  const pattern = /`([^`\n]+)`/g;
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), code: false });
    segments.push({ text: found[1] ?? '', code: true });
    last = start + found[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), code: false });
  return segments.length ? segments : [{ text: '', code: false }];
}

export function normalizeQuery(query: string) {
  return query.trim().toLocaleLowerCase('zh-CN');
}

/** Count case-insensitive, non-overlapping occurrences. */
export function countMatches(text: string, query: string): number {
  const needle = normalizeQuery(query);
  if (!needle) return 0;
  const haystack = text.toLocaleLowerCase('zh-CN');
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * Inline-code split, then highlight matches inside each segment. `offset` is the number of
 * matches in earlier messages so every match gets a conversation-wide index.
 */
export function highlightSegments(text: string, query: string, offset = 0): TextSegment[] {
  const needle = normalizeQuery(query);
  const result: TextSegment[] = [];
  let index = offset;
  for (const segment of splitInlineCode(text)) {
    if (!needle) {
      result.push({ ...segment, match: false });
      continue;
    }
    const lower = segment.text.toLocaleLowerCase('zh-CN');
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      if (at > from)
        result.push({ text: segment.text.slice(from, at), code: segment.code, match: false });
      result.push({
        text: segment.text.slice(at, at + needle.length),
        code: segment.code,
        match: true,
        matchIndex: index++,
      });
      from = at + needle.length;
    }
    if (from < segment.text.length)
      result.push({ text: segment.text.slice(from), code: segment.code, match: false });
  }
  return result;
}

/** Matches as rendered (inline code split first), so counts equal the highlighted marks. */
export function countHighlights(text: string, query: string): number {
  return highlightSegments(text, query).filter((segment) => segment.match).length;
}

/** Step through matches with wrap-around. */
export function stepMatch(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

/** Plain-text conversation outline used by the local, never-published 分享为模板 action. */
export function templateFromConversation(botName: string, userMessages: string[]): string {
  const prompts = userMessages
    .map((message) => message.trim())
    .filter(Boolean)
    .slice(0, 10);
  const lines = [`# ${botName} 对话模板`, ''];
  if (!prompts.length) lines.push('（当前对话还没有提问，可以从一个想法开始。）');
  else prompts.forEach((prompt, i) => lines.push(`${i + 1}. ${prompt.replace(/\s+/g, ' ')}`));
  lines.push('', '仅含你的提问，不含回复、记忆或连接资料。');
  return lines.join('\n');
}

/** Prepend the active chat-mode prefixes exactly once; shared by composer, Enter and quick prompts. */
export function composeModePrefix(
  raw: string,
  modes: { deepSearch?: boolean; deepThink?: boolean; funMode?: boolean },
): string {
  let input = raw;
  if (modes.deepSearch && !input.startsWith('[全网深搜]')) input = `[全网深搜] ${input}`;
  if (modes.deepThink && !input.includes('[深度思考]')) input = `[深度思考] ${input}`;
  if (modes.funMode && !input.includes('[幽默风趣]')) input = `[幽默风趣] ${input}`;
  return input;
}
