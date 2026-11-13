'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from './icon';
import { inlineParts, messageBlocks } from './message-format';

function Inline({ text }: { text: string }) {
  return inlineParts(text).map((part, index) =>
    part.kind === 'bold' ? (
      <strong key={index}>{part.text}</strong>
    ) : part.kind === 'code' ? (
      <code key={index}>{part.text}</code>
    ) : (
      part.text
    ),
  );
}
export function CopyMessage({ text, label = '复制回复' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <span className="copy-control">
      <Button
        variant="ghost"
        size="icon"
        className="message-action"
        aria-label={state === 'copied' ? '已复制' : label}
        title={state === 'copied' ? '已复制' : label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState('copied');
          } catch {
            setState('failed');
          }
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setState('idle'), 2000);
        }}
      >
        <Icon name={state === 'copied' ? 'check' : 'copy'} />
      </Button>
      <span role="status" className={state === 'failed' ? 'copy-failure' : 'sr-only'}>
        {state === 'copied'
          ? '已复制到剪贴板'
          : state === 'failed'
            ? '复制失败，请选择文字复制。'
            : ''}
      </span>
    </span>
  );
}
export function MessageContent({ text }: { text: string }) {
  return (
    <div className="message-content">
      {messageBlocks(text).map((block, index) => {
        if (block.kind === 'code')
          return (
            <div className="message-code" key={index}>
              <div className="code-heading">
                <span>{block.language || '代码'}</span>
                <CopyMessage text={block.text} label="复制代码" />
              </div>
              <pre>
                <code>{block.text}</code>
              </pre>
            </div>
          );
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={index}>
              {block.items.map((item, i) => (
                <li key={i}>
                  <Inline text={item} />
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === 'heading')
          return (
            <h3 key={index}>
              <Inline text={block.text} />
            </h3>
          );
        if (block.kind === 'quote')
          return (
            <blockquote key={index}>
              <Inline text={block.text} />
            </blockquote>
          );
        return (
          <p key={index}>
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
