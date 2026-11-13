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
import { normalizeQuery } from '../halo/text';
import { appendRevealChunks, normalizeMath, rehypeTextLeaves } from './text';

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

function CodeBlock({ node, children }: { node?: Element | undefined; children?: ReactNode }) {
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
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{language || '代码'}</span>
        <button
          type="button"
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
          {copy === 'copied'
            ? '已复制代码'
            : copy === 'failed'
              ? '复制失败，请手动选择'
              : '复制代码'}
        </button>
        <span className="sr-only" role="status">
          {copy === 'copied' ? '代码已复制' : ''}
        </span>
      </div>
      <pre>{children}</pre>
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
