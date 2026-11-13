# WEB-04：Halo（Grok Bot 风格）个人 Web 界面与动效

日期：2026-11-13。依据用户提供的 6 张 Grok Bot（“Halo”）手机截图与“重写 UI 与动画、尽量模仿界面与功能”的要求，按 [ADR-018](../architecture/decisions/0018-personal-web-halo-ui.md) 重写个人 Web（`/`）的视觉与交互结构。功能范围、安全与 Mock 限制沿用 [ADR-017](../architecture/decisions/0017-personal-web-increment.md) 与 [WEB-01](WEB_PERSONAL.md)–[WEB-03](WEB_03.md)：**没有新增服务端接口、数据库迁移或依赖，没有接入真实模型、真实 OAuth、第三方账号或语音**。M1-07 整体仍为 REVIEW，本轮不代表正式设计验收、原生端实现或真机证据。

## 范围

- **主题与令牌**：`@aven/design-tokens` 新增 `colors.halo`（与 light/dark 同键，纳入同一对比度测试）、`haloExtras`（用户气泡、授权蓝、徽标橙、开关、查找高亮）、`easing`、`duration.screen/sheet` 与 `radius.menu/sheet/tile`；构建脚本生成 `.aven-theme-halo` 与 `:root:has(.aven-theme-halo)` 变量块。组织控制台与 `/diagnostics` 不受影响。
- **结构**：手机优先的屏幕栈“首页 → Bot 资料页 / 对话页”，推入/返回滑动转场；桌面为居中 480px 手机列（≥ 640px 时加边框）。记忆、连接、通知、账号与占位说明改为底部 Sheet；连接器目录改为全高“连接应用”Sheet。
- **新文件**：`apps/web/src/features/personal/halo/`（`home.tsx`、`profile.tsx`、`connector-auth-card.tsx`、`primitives.tsx`、`plugin-logo.tsx`、`catalog.ts`、`navigation.ts`、`timeline.ts`、`text.ts`、`types.ts`、`halo.css`、`halo.test.ts`），`scripts/lib/personal-web-nav.mjs`；删除不再使用的 `modal.tsx`。
- **复验脚本适配**：`personal-web-*-verify.mjs` 与 `tests/e2e/personal-state.spec.ts` 改为先从首页进入对话、从“我的账号”Sheet 打开记忆/连接/通知，导航步骤抽到 `scripts/lib/personal-web-nav.mjs`。

## 屏幕

截图为 390×844（@2x）UI 夹具截图，存于 [`docs/design/screenshots/halo/`](../design/screenshots/halo/)。夹具在浏览器内拦截 `/api/v1/**` 返回合成数据（显示名“合成界面测试”、`ui-fixture@example.test`），**不经过真实 API/Worker/数据库，不是业务验证**。

| # | 文件 | 内容 | 数据来源 |
|---|---|---|---|
| 1 | `01-home.png` | 首页：头像、居中角色与“AVEN · AI · Mock 模式”、底部网格按钮与搜索 | 夹具 `auth/me` |
| 2 | `02-profile.png` | Bot 资料页：资料库、电脑（尚未开放）、配置 Bot 分组（连接应用、我的连接、添加到 Slack、定时任务）、通知主开关 | 夹具目录与通知偏好 |
| 3 | `03-library-sheet.png` | 资料库 Sheet：已确认信息 / 候选复核标签、新增记忆表单 | 夹具记忆 |
| 4 | `04-chat-empty.png` | 对话空状态：角色、“今天，想聊点什么？”与 Mock 说明 | — |
| 5 | `05-chat-auth-card.png` | 对话中的 Gmail 授权卡片（尚未添加 → 授权） | 本页规则插入 + 夹具目录 |
| 6 | `06-chat-menu.png` | “…”菜单：查看资料、在聊天中查找、分享为模板、新对话 | — |
| 7 | `07-chat-scrolled.png` | 向上滚动：头部回顾胶囊与“回到底部”按钮 | — |
| 8 | `08-auth-confirm.png` | 确认授权范围（Mock） | 本页状态 |
| 9 | `09-auth-authorizing.png` | 授权中（按钮内旋转指示） | 本页状态 |
| 10 | `10-auth-connected.png` | 已连接（Mock 授权 · 本页有效）与可直接调用的动作 | 本页状态 |
| 11 | `11-chat-find.png` | 在聊天中查找：高亮、1/2 计数与上下跳转 | — |
| 12 | `12-connect-apps.png` | 连接应用 Sheet：精选插件 + 按类别分组 + 搜索 | 夹具目录 |
| 13 | `13-connect-action-form.png` | 动作表单（按 `inputJsonSchema` 生成）与“调用（Mock 模式）” | 夹具目录 |
| 14 | `14-chat-widget.png` | 高德地点小组件带“Mock 数据”标签渲染进对话，外链需确认 | 夹具 Mock 结果 |
| 15 | `15-account-sheet.png` | 我的账号 Sheet：记忆、连接、通知、工程诊断、退出登录 | 夹具 `auth/me` |
| 16 | `16-connections-sheet.png` | 我的连接 Sheet：连接码、发起邀请、连接与邀请记录 | 夹具（空列表） |

## 动效

全部为 CSS（无新依赖），时长与缓动来自新令牌：

- 角色 8 种状态移植自 `docs/design/prototypes/mascot-motion`（idle 加入左右张望与双眨眼）；对话流式时 thinking，授权成功 happy。
- 屏幕推入/返回滑动；Sheet 上滑与遮罩淡入、关闭下滑；“…”菜单从触发角缩放淡入；消息上浮进入；打字指示与光标；头部回顾胶囊变形；回到底部按钮淡入；按压缩放；开关弹簧；授权按钮状态切换（授权 → 授权中旋转 → 已连接）；Toast 进出；骨架闪烁。
- `prefers-reduced-motion: reduce` 下停止循环与位移动画，只保留状态（颜色/文字）变化。

## 与 Grok 截图的有意偏差

- **不内置第三方品牌 Logo**：仓库无品牌资产授权，连接器统一为中性白色方块 + Lucide 类别图标。
- **次要文字更亮**：`foreground-secondary #A1A1A6`、`foreground-tertiary #9A9AA0`，保证在 `#141414` 等表面上 ≥ 4.5:1，比截图中的灰更亮。
- **麦克风与语音对话**：按钮保留外形，点击提示“尚未开放”，不录音、不请求麦克风权限。
- **Mock 标签**：回复下方“回复完成 · Mock”、授权卡片“Mock 授权 · 本页有效”、小组件“Mock 数据”、本页规则插入的提示标注“本页提示 · 非模型回复”。截图没有这些标签，AVEN 必须如实标注。
- **桌面 480px 手机列**：截图只有手机；桌面不另做宽屏布局，居中显示手机列。
- **反相角色**：截图为 Grok 自有头像；AVEN 使用自有正圆角色（白色主体、深色胶囊眼睛），不复制 Grok 资产。
- 资料页中“电脑”“添加到 Slack”“定时任务”“分享 Bot”“编辑 Bot”不存在于本范围，点击显示明确的“尚未开放”说明，不伪造状态；“空闲”“0 已开启”仅为静态占位。

## Mock 与限制

- 对话仍是确定性 Mock Agent（SSE），不是真实模型。
- 连接器授权是**纯前端 Mock**：只在当前页面内存记一个标志，不跳转第三方、不请求令牌、不改变服务端 `credentialStatus`，刷新即消失；已连接后的动作仍以 `allowLive: false` 调用服务端 Mock 适配器。
- “分享为模板”只把用户提问复制到剪贴板，不上传、不公开。“在聊天中查找”只搜索当前页面已渲染的消息。
- 没有历史会话列表；首页搜索框只用于进入对话，不检索历史。

## 验证

环境：Ubuntu arm64 沙箱，Node v24.22.3、pnpm 12.18.0、Playwright 1.65.0。合并基线为 `origin/main` `ed4926c`（2026-11-13 拉取时 main 无新提交，rebase 为空操作）。

| 检查 | 结果 |
|---|---|
| `pnpm format:check` | 通过 |
| `pnpm lint` | 通过（ESLint 0 警告；209 个模块、663 条依赖无边界违规） |
| `pnpm typecheck --force` | 20 个任务通过（无缓存） |
| `pnpm exec vitest run` | 47 个文件、331 项通过（新增 `halo.test.ts` 15 项；设计令牌测试覆盖 halo 对比度） |
| `turbo run build --filter='!@aven/mobile'` | 11 个任务通过 |
| `turbo run build`（含移动端） | 移动端失败：Expo 导出调用的 Hermes 编译器为 x86-64 二进制，无法在 arm64 沙箱执行；属既有环境问题，本轮未改移动端 |
| `pnpm test:e2e` | 12 项通过（desktop 与 mobile-web 项目各 6 项，含个人状态 3 项） |
| UI 夹具截图 | 390×844、1280×800 各 16 屏，以及 390×844 `prefers-reduced-motion: reduce` 16 屏；三轮浏览器控制台/页面错误均为 0；人工检查截图无真实姓名、邮箱或其他个人数据 |

**未执行**：`pnpm personal-web:verify`、`:verify:review`、`:verify:recovery`、`:verify:connector`（需要 PostgreSQL、Redis、已构建 API 与 Worker；本沙箱未启动这些服务）。脚本已按新导航改写，但改写后未实跑，下次在完整环境中必须先跑这四个脚本再声称回归通过。`check:expo`、真机、屏幕阅读器与 200% 文字放大检查也未执行。

## 下一步

- 在 Compose 环境实跑四个 `personal-web-*-verify` 脚本并记录结果。
- M1-07 正式双端评审时以本文截图为 Web 侧依据，确认 Halo 方向是否替代 v0.4 浅色方向。
- 原生端是否跟进 Halo 主题需单独决策；本轮未改 `apps/mobile`。
