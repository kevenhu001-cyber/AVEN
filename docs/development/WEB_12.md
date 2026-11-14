# WEB-12：个人 Web 第二轮 Grok 对齐（连接应用重排、composer 双钮与动效统一）

日期：2026-11-14。用户再次提供 5 张 Grok App 截图（Bot 资料页、聊天页与“…”菜单、聊天页键盘态、完整对话流、连接应用页），授权对个人 Web 做第二轮 UI 对齐，目标为稳定感、高级感、流畅感。视觉规则更新见 [DESIGN_SYSTEM](../design/DESIGN_SYSTEM.md) 第 1 节 WEB-12 小节（取代 WEB-11 中“未开放语音从输入区移除”一条）；整体仍遵循 [ADR-018](../architecture/decisions/0018-personal-web-halo-ui.md) 与 [ADR-021](../architecture/decisions/0021-personal-web-refinement.md)。本轮只调整前端呈现与既有交互，不新增业务能力、接口或迁移。

## 实现范围

- **连接应用页（`/apps`）重写为 Grok 布局**：页头保留 h1「连接应用」（E2E 锚点）并在 actions 位新增真实网关计数 pill「已连接 n 个」（`connectedServiceCount` 统计 `useConnectors` 状态）；列表从卡片改为扁平分区行（`.apps-heading` 分区标题 + `.apps-list` 行），行内为 logo + 名称/类别 + 两行截断描述 + 凭据状态行，右侧动作 pill 由 `appsRowAction` 决定：网关映射且未连接=蓝色「授权」（Link→`/connectors`）、已连接=「已连接」、无网关映射=禁用「未接入」。展开区收进 `.apps-expand` 卡片，保留动作 chips、`ActionForm`、`ResultCard` 与“未配置真实凭据”提示。搜索框移至 `.apps-searchbar`：桌面在页头下、移动端 sticky 贴底（Grok 样式），placeholder「搜索应用和技能」不变。`/apps/[id]` 详情模式保留。
- **聊天顶栏时间戳**：bot pill 右侧新增 `.halo-chat-stamp`，用 `formatChatTimestamp` 显示最近活动时间（今天/昨天/M月D日，60s 刷新），空对话不渲染；≤400px 隐藏。
- **输入区双钮三态**：composer 右侧常驻麦克风按钮（点击 toast「语音输入与语音模式尚未开放」）+ 主操作按钮三态 swap（`composerAction` 纯函数）：空草稿=白底「语音模式」占位钮（wave 图标）、有草稿=「发送消息」、运行中=「停止回复」。模式前缀逻辑抽为 `composeModePrefix` 纯函数，composer 提交、Enter 发送与快捷提问共用。
- **消息 meta 降噪与 hover-reveal**：状态文本（「回复完成」等，E2E 与复验脚本锚点）保持可见，弱化为 12px 三级文字；动作按钮（复制/朗读/赞踩/重新生成）包进 `.halo-msg-tools`，桌面 hover/focus 显现，最后一条已回复消息 pinned 常驻，触屏（`hover: none`）常驻；「再试一次」「核对发送结果」「重新读取回复」错误路径按钮始终可见。入场动画保留在子元素上（`data-fresh` 门控），父级透明度不影响其播放。
- **查找条双向过渡**：`.halo-find` 常挂载，开启/关闭均滑动过渡（180/200ms 令牌），关闭时 `inert` + `visibility: hidden` 移出可访问树与命中测试；`data-open` 驱动。
- **模式条配色收敛**：三个 mode pill 的激活态从硬编码 rgba/紫/琥珀色改为 `color-mix` + `--aven-color-accent` 单一强调色，去装饰化。
- **chat.tsx 组件拆分**：952 行拆出 `TurnArticle`/`TurnMeta`/`Composer` 子组件与 `CopyButton`/`SpeechButton`/`FeedbackButtons` 工具组件；`data-fresh` 判定仍集中在 `Chat` 渲染路径，行为不变。`chat-page.tsx` 新增 `onVoicePlaceholder` 回调（toast）。
- **资料页微调**：「电脑」行 value 改「空闲」（对齐截图），占位说明改为如实的「电脑接入尚未开放」；其余结构不变。
- **样式归位**：apps 页样式从卡片式重写为 Grok 扁平式（`shell.css` apps 区块），hover 块从 halo.css 合并进 shell.css，去重。

## 文件与架构

- `apps/web/src/features/personal/chat.tsx`：拆分重构 + 顶栏时间戳 + 三态 composer。
- `apps/web/src/features/personal/halo/{catalog.ts,text.ts}`：新增 `connectedServiceCount`、`appsRowAction`、`composerAction`、`composeModePrefix` 纯函数。
- `apps/web/src/features/personal/halo/halo.css`：时间戳、查找条过渡、meta hover-reveal、mode pill 配色、composer mic hover；reduced-motion 块继续覆盖（全局 transition/animation 1ms + 循环动画关闭）。
- `apps/web/src/components/shell/shell.css`：apps 页 Grok 布局（扁平行、底部搜索、展开卡片、计数 pill）。
- `apps/web/src/features/personal/apps-catalog.tsx`：目录页重写；`profile.tsx`、`pages/chat-page.tsx` 微调。
- `tests/e2e/personal-state.spec.ts`：移动端空 composer 断言从「发送禁用」改为「语音输入/语音模式可见、发送按钮不存在」（对应 WEB-12 规则）。
- `scripts/test-server.mjs`：Windows 下 spawn pnpm 需要 shell（本机 E2E 可用性修复，不影响 CI Linux 路径）。
- 顺手修复两个 HEAD 上已存在的 lint 错误（上一提交未过 lint）：组织 inbox 页未使用的 `orgId`/`useParams`、`chat.tsx` SpeechButton 正则多余转义 `\[`。

无数据库迁移、API 契约、权限、Provider、Open Connector 或业务状态机变化。`scripts/lib/personal-web-nav.mjs` 无需改动（导航结构与文案未变）。

## 实际检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e:personal
```

- format:check、lint（含依赖边界 272 模块）、完整 typecheck 20 个任务、单测 53 文件 / 374 项（新增 4 项纯函数测试）、完整构建 12 个任务全部通过。
- 个人 Web E2E 40 项通过（desktop / mobile-web，`PLAYWRIGHT_CHANNEL=chrome`），含更新后的移动端 composer 断言、plugin-directory 三项与 admin-config。
- 本机为 Windows + pnpm 12.18.0；`corepack pnpm` 因本机 corepack 版本不匹配报 `ERR_PNPM_BAD_PM_VERSION`，按提示直接使用 `pnpm` 执行，命令与 CI 一致。

## 视觉核对记录

使用生产构建在本地 3100 端口 + 项目 Playwright（本机 Chrome）+ 合成 `/api/v1` 夹具（同 E2E 夹具方式，无真实账号/模型/外部操作）截图核对：

| 页面 | 核对结果 |
| --- | --- |
| `/apps` 桌面 1280×900 | 页头 + 「已连接 2 个」pill + 分区扁平列表 + 右侧「已连接/未接入/授权（蓝）」pill + 页头下搜索栏，与 Grok 连接应用截图布局一致 |
| `/apps` 移动 390×844 | 搜索栏 sticky 贴底（在底部导航上方），行内 pill 正常，无横向溢出 |
| `/profile` 桌面 | 头像星标、编辑 pill、资料库/电脑（空闲）、配置 Bot 组、通知开关与帮助文案，对齐 Grok 资料页截图 |
| `/chat` 有对话（桌面） | 顶栏 bot pill + 「今天 HH:MM」时间戳；用户/助手气泡、meta 行「回复完成 + 复制/朗读/赞踩/重新生成」pinned 常驻 |
| `/chat` 空态（移动） | mascot + 「今天，想聊点什么？」+ 模式 pills + composer（+ / placeholder / mic / 白色波形钮）+ 快捷提问，对齐 Grok 输入区截图 |
| 发送后空草稿 | 「语音模式」占位钮出现，无「发送消息」按钮（E2E 断言同口径） |

## 已知限制与后续

- 语音输入与语音模式仍是诚实占位（点击 toast），未接入 ASR/TTS；电脑、Slack、定时任务仍为占位。
- 无会话历史 API/列表（沿袭 WEB-10 限制）；刷新后仍遵循原有内存状态边界。
- 未建立截图自动差异基线；人工核对不等于视觉回归系统或正式双端设计评审。
- 未做真实软键盘、200% 文字放大、读屏、真机或生产验证；合成 SSE 不代表模型能力或生产性能。
- 消息动作 hover-reveal 只用透明度/位移实现（不用 `pointer-events`），历史消息重开不重播（data-fresh 门控不变）。
