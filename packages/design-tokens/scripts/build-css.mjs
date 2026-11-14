import { writeFile } from 'node:fs/promises';
import {
  colors,
  space,
  radius,
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
  breakpoint,
  fontFamily,
  duration,
  easing,
  haloExtras,
  layout,
} from '../dist/index.js';

const variables = (values, prefix, unit = '') =>
  Object.entries(values)
    .map(([name, value]) => `  --aven-${prefix}-${name}: ${value}${unit};`)
    .join('\n');
const base = [
  variables(colors.light, 'color'),
  variables(space, 'space', 'px'),
  variables(radius, 'radius', 'px'),
  variables(fontSize, 'font-size', 'px'),
  variables(lineHeight, 'line-height'),
  variables(fontWeight, 'font-weight'),
  variables(letterSpacing, 'letter-spacing'),
  variables(breakpoint, 'breakpoint', 'px'),
  variables(layout, 'layout', 'px'),
  variables(fontFamily, 'font-family'),
  variables(duration, 'duration', 'ms'),
  variables(easing, 'easing'),
].join('\n');
const dark = variables(colors.dark, 'color');
const halo = [variables(colors.halo, 'color'), variables(haloExtras, 'halo')].join('\n');
const reducedMotion = Object.keys(duration)
  .map((name) => `    --aven-duration-${name}: 0ms;`)
  .join('\n');
await writeFile(
  new URL('../dist/tokens.css', import.meta.url),
  `/* Generated from src/index.ts. Do not edit this output. */\n:root {\n${base}\n  color-scheme: light;\n}\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${dark}\n    color-scheme: dark;\n  }\n}\n:root[data-theme="dark"] {\n${dark}\n  color-scheme: dark;\n}\n[data-aven-theme="halo"],\n.aven-theme-halo,\n:root:has(.aven-theme-halo) {\n${halo}\n  color-scheme: dark;\n}\n@media (prefers-reduced-motion: reduce) {\n  :root {\n${reducedMotion}\n  }\n  html {\n    scroll-behavior: auto;\n  }\n}\n`,
);
