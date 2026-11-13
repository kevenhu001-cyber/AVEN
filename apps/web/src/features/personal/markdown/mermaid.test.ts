import { describe, expect, it, vi } from 'vitest';
import { isMermaidLanguage, mermaidTheme, renderMermaid, sanitizeMermaid } from './mermaid';

describe('Mermaid rendering guards', () => {
  it('accepts only the mermaid fence language', () => {
    expect(isMermaidLanguage('mermaid')).toBe(true);
    expect(isMermaidLanguage(' Mermaid ')).toBe(true);
    expect(isMermaidLanguage('js')).toBe(false);
    expect(isMermaidLanguage('')).toBe(false);
  });

  it('escapes image tags before handing source to Mermaid', () => {
    expect(sanitizeMermaid('flowchart TD\n  A["<img src=x onerror=alert(1)>"]')).toBe(
      'flowchart TD\n  A["&lt;img src=x onerror=alert(1)>"]',
    );
    expect(sanitizeMermaid('flowchart TD\n  A[<image href="x">]')).toBe(
      'flowchart TD\n  A[&lt;image href="x">]',
    );
    expect(sanitizeMermaid('flowchart TD\n  A[label]')).toBe('flowchart TD\n  A[label]');
  });

  it('uses the dark Mermaid theme outside a browser', () => {
    expect(mermaidTheme()).toBe('dark');
  });

  it('returns null without loading Mermaid when the caller is already cancelled', async () => {
    const cancelled = vi.fn(() => true);
    await expect(renderMermaid('flowchart TD\n  A-->B', cancelled)).resolves.toBeNull();
    expect(cancelled).toHaveBeenCalled();
  });
});
