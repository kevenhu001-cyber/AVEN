import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import type { Element, Root, RootContent } from 'hast';
import type { Nodes } from 'mdast';
import { countMatches } from '../halo/text';

export const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const searchParser = markdownParser().use(remarkRehype);

function isMath(node: Root | Element) {
  if (node.type !== 'element') return false;
  const classes = node.properties.className;
  return Array.isArray(classes) && classes.includes('language-math');
}

/** Convert common model delimiters without rewriting code, HTML, links or existing math. */
export function normalizeMath(text: string): string {
  if (!text.includes('\\(') && !text.includes('\\[')) return text;
  const ranges: { start: number; end: number }[] = [];
  function visit(node: Nodes) {
    if (['code', 'inlineCode', 'html', 'link', 'image', 'math', 'inlineMath'].includes(node.type)) {
      if (node.position?.start.offset !== undefined && node.position.end.offset !== undefined)
        ranges.push({ start: node.position.start.offset, end: node.position.end.offset });
      return;
    }
    if ('children' in node) node.children.forEach(visit);
  }
  markdownParser.parse(text).children.forEach(visit);
  const pattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
  return text.replace(
    pattern,
    (match: string, inline: string | undefined, block: string | undefined, at: number) => {
      if (ranges.some((range) => at < range.end && at + match.length > range.start)) return match;
      // An escaped backslash is literal, not a formula delimiter.
      let slashes = 0;
      for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
      if (slashes % 2) return match;
      return inline !== undefined ? `$${inline}$` : `\n$$\n${block}\n$$\n`;
    },
  );
}

/** Same text leaves as the renderer; syntax, link targets, HTML and formulas are excluded. */
export function countMarkdownHighlights(text: string, query: string): number {
  if (!query.trim()) return 0;
  let count = 0;
  function visit(node: Root | Element) {
    if (isMath(node)) return;
    for (const child of node.children) {
      if (child.type === 'text' && child.value.trim()) count += countMatches(child.value, query);
      else if (child.type === 'element') visit(child);
    }
  }
  const tree = searchParser.runSync(searchParser.parse(normalizeMath(text)));
  visit(tree);
  return count;
}

/** Mark text leaves before KaTeX runs, so math DOM and accessibility text remain intact. */
export function rehypeTextLeaves(options: { query: string; offset: number }) {
  return (tree: Root) => {
    let offset = options.offset;
    function walk(parent: Root | Element) {
      if (isMath(parent)) return;
      parent.children = parent.children.map((child): RootContent => {
        if (child.type === 'text' && child.value.trim()) {
          const start = offset;
          offset += countMatches(child.value, options.query);
          return {
            type: 'element',
            tagName: 'span',
            properties: { 'data-aven-text': true, 'data-search-offset': start },
            children: [child],
          };
        }
        if (child.type === 'element') walk(child);
        return child;
      });
    }
    walk(tree);
  };
}

export type RevealChunk = { text: string; start: number; fresh: boolean };

/** Keep append-only spans stable, with bounded DOM size for long-running streams. */
export function appendRevealChunks(previous: RevealChunk[], text: string): RevealChunk[] {
  const old = previous.map((chunk) => chunk.text).join('');
  if (text === old) return previous;
  if (!text.startsWith(old)) return [{ text, start: 0, fresh: false }];
  const chunks = previous.filter((chunk) => chunk.text);
  const tail = chunks[chunks.length - 1];
  // Do not split a UTF-16 surrogate pair across DOM text nodes.
  if (tail && /[\uD800-\uDBFF]$/.test(old) && /^[\uDC00-\uDFFF]/.test(text.slice(old.length)))
    chunks[chunks.length - 1] = { ...tail, text: tail.text + text.slice(old.length) };
  else chunks.push({ text: text.slice(old.length), start: old.length, fresh: true });
  if (chunks.length <= 32) return chunks;
  const head = chunks
    .slice(0, -16)
    .map((chunk) => chunk.text)
    .join('');
  return [{ text: head, start: 0, fresh: false }, ...chunks.slice(-16)];
}
