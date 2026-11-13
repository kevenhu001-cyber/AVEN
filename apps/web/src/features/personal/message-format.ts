export type MessageBlock =
  | { kind: 'paragraph' | 'heading' | 'quote'; text: string }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

/** A deliberately small Markdown subset. Raw HTML and URLs remain inert text. */
export function messageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = /^\s*```([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) code.push(lines[index++]!);
      if (index < lines.length) index++;
      blocks.push({ kind: 'code', text: code.join('\n'), language: fence[1] ?? '' });
      continue;
    }
    const heading = /^#{1,6}\s+(.+)/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1]! });
      index++;
      continue;
    }
    const quote = /^>\s?(.*)/.exec(line);
    if (quote) {
      blocks.push({ kind: 'quote', text: quote[1]! });
      index++;
      continue;
    }
    const list = /^(?:([-*])|(\d+)\.)\s+(.+)/.exec(line);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const next = /^(?:([-*])|(\d+)\.)\s+(.+)/.exec(lines[index]!);
        if (!next || Boolean(next[2]) !== ordered) break;
        items.push(next[3]!);
        index++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(?:\s*```|#{1,6}\s|>\s?|[-*]\s|\d+\.\s)/.test(lines[index]!)
    )
      paragraph.push(lines[index++]!);
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}
export function inlineParts(text: string) {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
    .filter(Boolean)
    .map((value) =>
      value.startsWith('**') && value.endsWith('**')
        ? { kind: 'bold' as const, text: value.slice(2, -2) }
        : value.startsWith('`') && value.endsWith('`')
          ? { kind: 'code' as const, text: value.slice(1, -1) }
          : { kind: 'text' as const, text: value },
    );
}
