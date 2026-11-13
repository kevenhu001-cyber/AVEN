import type { Mermaid } from 'mermaid';

type MermaidApi = Mermaid;

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderQueue: Promise<void> = Promise.resolve();
let nextId = 0;

/** Code fences labelled `mermaid` can render as a diagram instead of source. */
export function isMermaidLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'mermaid';
}

/** Escape image tags so a diagram cannot load remote resources as a side effect. */
export function sanitizeMermaid(code: string): string {
  return code.replace(/<((?:img|image)\s+)/gi, '&lt;$1');
}

/** Halo is the only chat theme today; the fallback keeps SSR/unit runs deterministic. */
export function mermaidTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'dark';
  return document.querySelector('.aven-theme-halo') ? 'dark' : 'default';
}

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid')
    .then((module) => module.default)
    .catch((error: unknown) => {
      mermaidPromise = null;
      throw error;
    });
  return mermaidPromise;
}

/**
 * Render one diagram at a time: Mermaid keeps global configuration, so
 * concurrent calls would race. A failed diagram does not block the queue.
 */
export function renderMermaid(code: string, isCancelled: () => boolean): Promise<string | null> {
  const task = renderQueue.then(async () => {
    if (isCancelled() || !code.trim()) return null;
    const mermaid = await loadMermaid();
    if (isCancelled()) return null;
    mermaid.initialize({
      theme: mermaidTheme(),
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
    });
    const { svg } = await mermaid.render(`aven-mermaid-${nextId++}`, sanitizeMermaid(code));
    return isCancelled() ? null : svg;
  });
  renderQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
