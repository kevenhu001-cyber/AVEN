'use client';

import {
  createContext,
  memo,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Element } from 'hast';
import { Icon } from '../icon';
import { normalizeQuery } from '../halo/text';
import { appendRevealChunks, normalizeMath, rehypeTextLeaves } from './text';
import {
  findSearchMatches,
  getLanguageLabel,
  sliceTokenWithMatches,
  tokenizeToLines,
} from './syntax';

type RenderState = { query: string; current: number; animate: boolean };
const RenderContext = createContext<RenderState>({ query: '', current: 0, animate: false });
const remarkPlugins = [remarkGfm, remarkMath];
const katexOptions = { trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20 };

function highlighted(text: string, query: string, offset: number, current: number): ReactNode {
  const needle = normalizeQuery(query);
  if (!needle) return text;
  const result: ReactNode[] = [];
  const lower = text.toLocaleLowerCase('zh-CN');
  let from = 0;
  let index = offset;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    result.push(text.slice(from, at));
    result.push(
      <mark key={at} className="halo-mark" data-match={index} data-current={index === current}>
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    index++;
    from = at + needle.length;
  }
  result.push(text.slice(from));
  return result;
}

function TextLeaf({ text, offset }: { text: string; offset: number }) {
  const { query, current, animate } = useContext(RenderContext);
  const [state, setState] = useState(() => ({
    text,
    chunks: [{ text, start: 0, fresh: animate }],
  }));
  if (text !== state.text) setState({ text, chunks: appendRevealChunks(state.chunks, text) });
  else if (query && state.chunks.some((chunk) => chunk.fresh))
    setState({ ...state, chunks: state.chunks.map((chunk) => ({ ...chunk, fresh: false })) });
  // Search spans the whole leaf, even when a match crosses two network chunks.
  if (query || !animate) return highlighted(text, query, offset, current);
  return state.chunks.map((chunk) => (
    <span key={chunk.start} className={chunk.fresh ? 'markdown-reveal' : undefined}>
      {chunk.text}
    </span>
  ));
}

function RenderSpan({
  node,
  children,
  ...props
}: ComponentProps<'span'> & { node?: Element | undefined }) {
  if (node?.properties['data-aven-text']) {
    const text = node.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
    return <TextLeaf text={text} offset={Number(node.properties['data-search-offset']) || 0} />;
  }
  return <span {...props}>{children}</span>;
}

function nodeText(node: Element): string {
  return node.children
    .map((child) =>
      child.type === 'text' ? child.value : child.type === 'element' ? nodeText(child) : '',
    )
    .join('');
}

function findSearchOffset(element?: Element): number {
  if (!element) return 0;
  for (const child of element.children) {
    if (child.type === 'element') {
      if (
        child.properties['data-aven-text'] &&
        child.properties['data-search-offset'] !== undefined
      ) {
        return Number(child.properties['data-search-offset']) || 0;
      }
      const nested = findSearchOffset(child);
      if (nested > 0) return nested;
    }
  }
  return 0;
}

function CodeBlock({ node }: { node?: Element | undefined; children?: ReactNode }) {
  const source = node ? nodeText(node).replace(/\n$/, '') : '';
  const [copyState, setCopyState] = useState<{
    source: string;
    status: 'idle' | 'copied' | 'failed';
  }>({ source, status: 'idle' });
  if (source !== copyState.source) setCopyState({ source, status: 'idle' });
  const copy = copyState.status;

  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const classes = code?.type === 'element' ? code.properties.className : undefined;
  const language = Array.isArray(classes)
    ? String(classes.find((name) => String(name).startsWith('language-')) ?? '').slice(9)
    : '';
  const langLabel = getLanguageLabel(language);

  const { query, current } = useContext(RenderContext);
  const baseOffset = useMemo(() => findSearchOffset(node), [node]);
  const matches = useMemo(
    () => findSearchMatches(source, query, baseOffset),
    [source, query, baseOffset],
  );
  const lines = useMemo(() => tokenizeToLines(source, language), [source, language]);
  const isMultiLine = lines.length > 1;
  const isLong = lines.length > 24;
  const [userExpanded, setUserExpanded] = useState(false);
  const isCollapsed = isLong && !userExpanded && matches.length === 0;
  const displayedLines = isCollapsed ? lines.slice(0, 18) : lines;

  let charPos = 0;

  return (
    <div
      className="markdown-code-block"
      data-multiline={isMultiLine ? 'true' : 'false'}
      data-collapsed={isCollapsed ? 'true' : 'false'}
    >
      <div className="markdown-code-toolbar">
        <span className="markdown-code-lang">
          <span className="markdown-code-lang-dot" aria-hidden="true" />
          {langLabel}
        </span>
        <button
          type="button"
          className="markdown-code-copy-btn"
          onClick={() => {
            if (!node) return;
            void navigator.clipboard.writeText(source).then(
              () =>
                setCopyState((state) =>
                  state.source === source ? { source, status: 'copied' } : state,
                ),
              () =>
                setCopyState((state) =>
                  state.source === source ? { source, status: 'failed' } : state,
                ),
            );
          }}
        >
          <Icon
            name={copy === 'copied' ? 'check' : 'copy'}
            size={13}
            className={copy === 'copied' ? 'token-copied-icon' : ''}
          />
          <span>
            {copy === 'copied'
              ? '已复制代码'
              : copy === 'failed'
                ? '复制失败，请手动选择'
                : '复制代码'}
          </span>
        </button>
        <span className="sr-only" role="status">
          {copy === 'copied' ? '代码已复制' : ''}
        </span>
      </div>
      <pre className="markdown-code-pre">
        <code>
          {displayedLines.map((lineTokens, lineIdx) => {
            const renderedTokens = lineTokens.map((token, tokenIdx) => {
              const tokenStart = charPos;
              charPos += token.text.length;
              const segments = sliceTokenWithMatches(token.text, tokenStart, matches, current);

              if (segments.length === 1 && !segments[0]!.match) {
                return (
                  <span key={tokenIdx} className={`token token-${token.type}`}>
                    {token.text}
                  </span>
                );
              }

              return (
                <span key={tokenIdx} className={`token token-${token.type}`}>
                  {segments.map((seg, sIdx) =>
                    seg.match ? (
                      <mark
                        key={sIdx}
                        className="halo-mark"
                        data-match={seg.matchIndex}
                        data-current={seg.isCurrent}
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      seg.text
                    ),
                  )}
                </span>
              );
            });

            if (lineIdx < displayedLines.length - 1) {
              charPos += 1;
            }

            return (
              <div key={lineIdx} className="markdown-code-line">
                {isMultiLine && (
                  <span className="markdown-code-gutter" aria-hidden="true">
                    {lineIdx + 1}
                  </span>
                )}
                <span className="markdown-code-content">
                  {lineTokens.length > 0 ? renderedTokens : '\n'}
                </span>
              </div>
            );
          })}
        </code>
      </pre>
      {isLong && (
        <div className={`markdown-code-expand-bar ${isCollapsed ? 'collapsed' : 'expanded'}`}>
          <button
            type="button"
            className="markdown-code-expand-btn"
            onClick={() => setUserExpanded((prev) => !prev)}
            aria-expanded={!isCollapsed}
          >
            <Icon name={isCollapsed ? 'down' : 'up'} size={14} />
            <span>
              {isCollapsed ? `展开剩余 ${lines.length - 18} 行代码` : '收起代码'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

const components: Components = {
  span: RenderSpan,
  pre: CodeBlock,
  table: ({ children }) => (
    <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="回复表格">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Model-selected remote resources must never load as a side effect of reading a reply.
  img: ({ alt }) => <span className="markdown-image-placeholder">[图片：{alt || '未加载'}]</span>,
};

function safeUrl(url: string) {
  const safe = defaultUrlTransform(url);
  return /^(https?:|mailto:)/i.test(safe) ||
    (safe.startsWith('/') && !safe.startsWith('//')) ||
    safe.startsWith('#')
    ? safe
    : '';
}

export const MarkdownMessage = memo(function MarkdownMessage({
  text,
  query,
  offset,
  current,
  animate,
}: {
  text: string;
  query: string;
  offset: number;
  current: number;
  animate: boolean;
}) {
  const source = useMemo(() => normalizeMath(text), [text]);
  const renderState = useMemo(() => ({ query, current, animate }), [query, current, animate]);
  return (
    <RenderContext.Provider value={renderState}>
      <div className="markdown-message">
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={[
            [rehypeTextLeaves, { query, offset }],
            [rehypeKatex, katexOptions],
          ]}
          components={components}
          skipHtml
          urlTransform={safeUrl}
        >
          {source}
        </Markdown>
      </div>
    </RenderContext.Provider>
  );
});
