import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  colors,
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
  breakpoint,
  fontFamily,
} from './index';

function luminance(hex: string) {
  const values = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const surfaces = [
  'background',
  'background-secondary',
  'surface',
  'surface-secondary',
  'surface-hover',
  'surface-active',
  'surface-selected',
  'disabled-background',
  'accent-surface',
  'destructive-surface',
  'success-surface',
  'warning-surface',
  'info-surface',
] as const;

describe('semantic token contrast, not rendered accessibility certification', () => {
  it('keeps themes structurally aligned', () => {
    expect(Object.keys(colors.light)).toEqual(Object.keys(colors.dark));
  });
  it.each(['light', 'dark'] as const)('%s readable text and essential boundaries', (theme) => {
    const tokens = colors[theme];
    for (const background of surfaces) {
      expect(contrast(tokens.foreground, tokens[background])).toBeGreaterThanOrEqual(4.5);
      for (const edge of ['focus-ring', 'control-border'] as const)
        expect(contrast(tokens[edge], tokens[background])).toBeGreaterThanOrEqual(3);
    }
    for (const text of [
      'foreground-secondary',
      'foreground-tertiary',
      'accent',
      'destructive',
      'success',
      'warning',
      'info',
    ] as const) {
      for (const background of [
        'background',
        'background-secondary',
        'surface',
        'surface-secondary',
      ] as const) {
        expect(contrast(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const [text, background] of [
      ['accent', 'accent-surface'],
      ['destructive', 'destructive-surface'],
      ['success', 'success-surface'],
      ['warning', 'warning-surface'],
      ['info', 'info-surface'],
    ] as const) {
      expect(contrast(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(tokens['disabled-foreground'], tokens['disabled-background']),
    ).toBeGreaterThanOrEqual(3);
    for (const button of ['primary', 'accent', 'destructive'] as const)
      expect(contrast(tokens[`${button}-foreground`], tokens[button])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('typography and layout scales', () => {
  it('defines line heights for every text size', () => {
    expect(Object.keys(lineHeight)).toEqual(Object.keys(fontSize));
  });
  it('keeps weights and letter spacing finite', () => {
    expect(Object.values(fontWeight).every((value) => value >= 400 && value <= 700)).toBe(true);
    expect(letterSpacing.brand).toBe('0.12em');
    expect(breakpoint.sm).toBeLessThan(breakpoint.md);
    expect(breakpoint.md).toBeLessThan(breakpoint.lg);
    expect(fontFamily.sans).toContain('PingFang SC');
    expect(fontFamily.mono).toContain('monospace');
  });
});

describe('generated CSS', () => {
  const css = readFileSync(new URL('../dist/tokens.css', import.meta.url), 'utf8');
  it('emits typography, layout, and theme variables', () => {
    expect(css).toContain('--aven-line-height-body: 1.65;');
    expect(css).toContain('--aven-font-weight-semibold: 600;');
    expect(css).toContain('--aven-font-family-sans:');
    expect(css).toContain('--aven-breakpoint-md: 768px;');
    expect(css).toContain(':root[data-theme="dark"]');
  });
  it('disables motion durations when reduced motion is requested', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('--aven-duration-fast: 0ms;');
    expect(css).toContain('scroll-behavior: auto;');
  });
});
