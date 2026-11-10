import { describe, expect, it } from 'vitest';
import { colors } from './index';

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
describe('semantic token contrast, not rendered accessibility certification', () => {
  it('keeps themes structurally aligned', () => {
    expect(Object.keys(colors.light)).toEqual(Object.keys(colors.dark));
  });
  it.each(['light', 'dark'] as const)('%s readable text and essential boundaries', (theme) => {
    const tokens = colors[theme];
    for (const background of [
      'background',
      'background-secondary',
      'surface',
      'surface-secondary',
    ] as const) {
      for (const text of [
        'foreground',
        'foreground-secondary',
        'foreground-tertiary',
        'accent',
        'destructive',
        'success',
        'warning',
        'info',
      ] as const) {
        expect(contrast(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5);
      }
      for (const edge of ['focus-ring', 'control-border'] as const)
        expect(contrast(tokens[edge], tokens[background])).toBeGreaterThanOrEqual(3);
    }
    for (const button of ['primary', 'accent', 'destructive'] as const)
      expect(contrast(tokens[`${button}-foreground`], tokens[button])).toBeGreaterThanOrEqual(4.5);
  });
});
