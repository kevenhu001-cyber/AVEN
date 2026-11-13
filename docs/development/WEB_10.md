# WEB-10：侧边栏重构与 Markdown 渲染增强

日期：2026-11-14。范围：个人 Web 共享外壳（`apps/web/src/components/shell/`）与助手正文渲染（`apps/web/src/features/personal/markdown/`）。参考仓库内第三方演示 `chat-demo-main/` 的侧边栏与 Markdown 实现，按用户选择的「折叠栏 + 抽屉 + 分组导航 + 新对话」与「再加 Mermaid 图表」范围借鉴。无数据库迁移、无 HTTP 契约变化。

## 实现

### 共享外壳

- 侧边栏改为分组导航：`对话`（首页、对话、我的连接）与 `我的空间`（连接应用、记忆与上下文、通知、Bot 资料）。分组标题使用 `aria-labelledby`，导航区域可滚动，底部固定模型状态与账号行。
- 桌面可折叠为图标栏：`data-collapsed` 控制宽度、隐藏文字标签、把「新对话」收成圆形图标按钮。折叠状态写入 `localStorage` 的 `aven.shell.sidebar`（`collapsed` / `expanded`）；没有存储值时按 `max-width: 1080px` 决定默认值。读取使用 `useSyncExternalStore`，服务端快照固定为展开，避免水合不一致。
- 新增「新对话」按钮：可访问名称为 `开启新对话`（与首页可见的「新对话」按钮区分，避免测试定位冲突），点击重置共享对话状态并跳转 `/chat`，生成中禁用。
- 移动端：顶栏菜单按钮（`打开导航`）与底部导航的「更多」项（可访问名称 `更多导航`）打开 Radix Dialog 抽屉；抽屉按当前路由标记打开状态，导航、关闭按钮或 Escape 都会关闭，不需要在 effect 中回写状态。底部导航保持 4 个主入口加「更多」。
- 过渡与减少动态：侧栏宽度、导航项、按钮、抽屉入场动画都使用设计令牌；`prefers-reduced-motion: reduce` 下移除过渡、按压位移与抽屉动画。
- 平台页与组织控制台沿用同一外壳的分组逻辑，组织控制台仍隐藏侧栏与底部导航。

### Markdown 渲染

- 流式节流：新增 `use-throttled-text.ts`，按上一帧实际渲染耗时 × 2 决定下一次解析时间，上限 2 秒；连续增量合并为最新文本。关闭节流或尚未产生节流帧时直接返回最新文本，因此完成态不会滞后。查找激活时停用节流，保证高亮偏移与整段正文计数一致。
- 排版：借鉴演示的标题层级与间距、列表/嵌套列表、引用、表格（首列与末列内边距、表头底色、行悬停）、链接（默认无下划线、悬停显示、焦点环）、分隔线与行内代码。
- 任务列表：GFM `task-list-item` 使用 flex 对齐，复选框尺寸与强调色固定，忽略默认列表标记。
- 代码块：Mermaid 代码块工具栏显示「图表 / 代码」切换（`aria-pressed`），查找时强制代码视图并禁用切换；复制反馈 2 秒后自动复位，代码继续流式变化时立即复位。
- Mermaid：`mermaid@12.3.0` 动态导入，独立 chunk（构建产物中最大约 465 KB，不进入首屏路由包）。`securityLevel: 'strict'`、`startOnLoad: false`、`suppressErrorRendering: true`；渲染前把 `<img>` / `<image>` 标签转义，避免图表触发远程资源请求。绘制串行排队，避免全局配置互相覆盖；Halo 主题下使用 dark 主题。
- 流式图表：绘制最新完整内容，失败时回退到最后一个完整前缀并保留上一张有效图；只有回复结束后才显示语法错误提示，避免把未闭合的流式片段当成错误。取消或组件卸载后丢弃结果。
- 图表与表格回复使用整条气泡宽度（`width: 100%`，仍受 88% 上限约束），避免图被压到约 250px。图表在回复结束后才插入，会改变内容高度；对话区新增 `ResizeObserver`，仅在用户原本贴底时重新贴底，向上翻阅的读者不会被拉回。
- 未改变的安全边界：仍禁用原始 HTML，链接只允许 `http` / `https` / `mailto` / 站内路径，远程图片只显示占位，公式继续使用 `trust: false`。

## 状态与验证范围

| 状态 | 行为 |
| --- | --- |
| 桌面展开 | 分组导航、新对话、模型状态与账号可见；当前路由高亮 |
| 桌面折叠 | 图标栏 + 圆形新对话按钮；刷新后保持；`localStorage` 不可用时退回视口默认值 |
| 窄屏（≤1080px，无存储值） | 默认折叠 |
| 移动端 | 顶栏菜单与底部「更多」打开抽屉；导航/Escape/关闭按钮关闭 |
| 流式正文 | 按渲染耗时节流解析；查找时停用节流；完成态立即使用最新文本 |
| Mermaid 流式 | 保留上一张有效图，结束后才报告语法错误 |
| Mermaid 完成 | 图表插入后若原本贴底则保持贴底；气泡使用整条宽度 |
| Mermaid 查找 | 强制代码视图，切换按钮禁用，命中数按源码计算 |
| 减少动态 | 侧栏、导航、按钮与抽屉动画关闭 |

## 实际执行的检查

```bash
corepack pnpm format:check
corepack pnpm lint
cd apps/web && corepack pnpm exec tsc --noEmit
corepack pnpm test
corepack pnpm --filter @aven/web build
PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e:personal
```

结果：

- `format:check`、`lint`（含 `check:boundaries`）、`apps/web` typecheck 通过。
- 单测 53 文件 / 370 项通过（新增 `mermaid.test.ts` 4 项与 `mermaid` 语言标签断言）。
- `@aven/web` 生产构建通过；Mermaid 输出为独立异步 chunk。
- 个人 Web E2E 36 项通过（原 30 项 + 新增 6 项：侧栏折叠与持久化、移动抽屉、Mermaid 图表与源码切换，各在 desktop / mobile-web 两个 project 运行）。
- 浏览器截图复核 1280×900 展开/折叠与 390×844 首页/抽屉，未见溢出或遮挡；截图仅作人工检查，不作为 E2E 或设计验收证据。

## 已知限制

- 没有会话历史列表：AVEN 目前没有会话列表 API，侧栏不显示最近对话、重命名或删除，也不做本地快照。演示中的会话分组与操作未移植。
- 折叠偏好按浏览器保存，不随账号同步；多标签页通过 `storage` 事件同步，同一标签内的写入通过本地订阅通知。
- Mermaid 只做 `strict` 模式与图片标签转义，没有额外的图表语法白名单、缩放/平移、导出或全屏。
- 抽屉与桌面侧栏共用同一套导航数据，移动端会同时存在隐藏的桌面导航 DOM，读屏用户通过抽屉访问；未做焦点陷阱之外的额外优化（Radix Dialog 已提供焦点管理）。
- `chat-demo-main/` 是参考用第三方副本，不在 pnpm workspace 内，已加入 `.prettierignore` 与 ESLint `ignores`，不参与构建、格式与 lint 检查。
- 本轮未做视觉回归基线、真实模型下的长回复性能测量或低端设备帧率验证。
