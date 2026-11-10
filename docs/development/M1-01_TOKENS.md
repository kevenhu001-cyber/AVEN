# M1-01 设计令牌与主题

日期：2026-11-11 · 状态：令牌层已实现并验证；组件、页面与双端设计评审未完成

## 范围

本轮完成浅/深色语义色、状态色、字体族、字号/行高/字重/字距、间距、圆角、断点与动效令牌，并在 Web/Expo 中使用。它不是高保真设计、组件库或页面验收；M1-07 的核心旅程双端评审仍是 UI 编码门。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/design-tokens/src/index.ts` | 语义色、状态/禁用色、字体族、字号、行高、字重、字距、间距、圆角、断点、动效 |
| `packages/design-tokens/scripts/build-css.mjs` | 生成 CSS 变量、深色主题、`prefers-reduced-motion` |
| `packages/design-tokens/src/index.test.ts` | 结构对齐、对比度矩阵、排版比例、生成 CSS 检查 |
| `apps/web/src/app/globals.css` | 使用字体/行高/字重/字距变量 |
| `apps/web/src/app/layout.tsx` | `color-scheme` 与浅/深色浏览器主题色 |
| `apps/mobile/app/index.tsx` | 使用字号/行高令牌，移除硬编码行高 |

## 令牌要点

- 浅/深色主题键完全对齐；新增 `surface-hover`、`surface-active`、`surface-selected`、状态浅背景、禁用色。
- `lineHeight` 与 `fontSize` 键一一对应；Web 输出 `--aven-line-height-*`，原生按字号乘行高。
- `fontFamily.sans` 包含中文回退；`fontFamily.mono` 用于标识符；不依赖未验证的海外字体 CDN。
- 断点 `sm/md/lg/xl` 输出为 `--aven-breakpoint-*`。
- `prefers-reduced-motion: reduce` 将所有 `--aven-duration-*` 置为 `0ms`，并设置 `scroll-behavior: auto`；状态信息不得只靠动画表达。

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm test` | 52/52 通过；设计令牌 7 项（结构、对比度、排版、生成 CSS、减少动态） |
| `corepack pnpm typecheck` | 18/18 Turbo tasks 通过 |
| `corepack pnpm build` | 11/11 Turbo tasks 通过 |
| `corepack pnpm test:e2e` | 6/6 通过；桌面/Pixel 7 无横向溢出 |
| `corepack pnpm check:expo` | 依赖与 SDK 58 匹配 |

对比度测试覆盖：

- 13 个浅/深色表面上的主文字 ≥4.5:1；焦点环/控件边界 ≥3:1。
- 7 个辅助/状态文字在主背景/次级表面 ≥4.5:1。
- 5 组状态文字与状态浅背景 ≥4.5:1。
- 禁用文字与禁用背景 ≥3:1；主/强调/危险按钮文字 ≥4.5:1。

这是静态 sRGB 令牌计算，不是浏览器/原生渲染、透明度、字体回退或屏幕阅读器验收。

## 未完成

- 组件级 hover/focus/disabled/loading/error 视觉与键盘验证。
- 双端高保真、可点击原型、状态矩阵与 M1-07 评审。
- 真机字体缩放、Safe Area、键盘与深色模式实测。
- 视觉回归基线；当前 E2E 只验证布局与探针行为。
