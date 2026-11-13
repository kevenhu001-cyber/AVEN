'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { renderMermaid } from './mermaid';

const RETRY_MS = 120;

/**
 * Draws the latest complete-looking Mermaid source while a reply streams and
 * keeps the last valid SVG until a newer one succeeds. Syntax errors are only
 * reported once the stream finishes, because the tail of a stream is often
 * incomplete.
 */
export const MermaidDiagram = memo(function MermaidDiagram({
  code,
  loading,
}: {
  code: string;
  loading: boolean;
}) {
  const [result, setResult] = useState({ svg: '', failedCode: null as string | null });
  const latest = useRef(code);
  latest.current = code;
  const finalCode = loading ? null : code;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous: string | undefined;
    let displayed: string | undefined;

    const draw = async (input: string) => {
      if (input === displayed || cancelled) return;
      const svg = await renderMermaid(input, () => cancelled);
      if (svg && !cancelled) {
        displayed = input;
        setResult({ svg, failedCode: null });
      }
    };

    const tick = async () => {
      const input = latest.current;
      if (input !== previous) {
        previous = input;
        try {
          await draw(input);
        } catch {
          if (cancelled) return;
          if (loading) {
            // The last line of an unfinished stream may be an incomplete node;
            // draw the longest complete prefix and keep any previous diagram.
            const text = input.trimEnd();
            const lineEnd = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
            const prefix = text.slice(0, Math.max(0, lineEnd));
            if (prefix && !displayed?.startsWith(prefix)) {
              try {
                await draw(prefix);
              } catch {
                // A prefix can be incomplete too; keep the last valid diagram.
              }
            }
          } else {
            setResult({ svg: '', failedCode: input });
          }
        }
      }
      if (!cancelled && loading) timer = setTimeout(() => void tick(), RETRY_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loading, finalCode]);

  if (!code.trim()) {
    return (
      <div className="markdown-mermaid-status" role="status">
        图表内容为空。
      </div>
    );
  }

  if (!result.svg) {
    return (
      <div className="markdown-mermaid-status" role="status">
        {result.failedCode === code && !loading ? '图表语法有误，已保留代码。' : '正在绘制图表…'}
      </div>
    );
  }

  return (
    <div
      className="markdown-mermaid-diagram"
      role="img"
      aria-label="Mermaid 图表"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
});
