# WEB-13：会话历史全栈交付与语音听写真实化

日期：2026-11-14。用户要求「功能全部做好」后，对照既有计划确认两个真实功能缺口并交付：**会话历史**（此前为 WEB-10 已知限制：无列表 API，刷新即丢对话）与**语音输入**（WEB-11 起为死占位）。本轮为全栈增量，决策依据见 [DESIGN_SYSTEM](../design/DESIGN_SYSTEM.md) WEB-12/WEB-13 小节与 [ADR-018](../architecture/decisions/0018-personal-web-halo-ui.md)、[ADR-021](../architecture/decisions/0021-personal-web-refinement.md)。

## 实现范围

### A. 会话历史（数据 → API → 客户端 → 界面）

- **持久化事实**：用户输入与 AI 最终回复本就完整保存在 `public.messages.body`（`derived_from_run_id` 区分角色，`uq_messages_derived_from_run` 保证一 run 一回复），`agent_run_events` 24 小时过期，因此历史恢复读 `messages` 而非事件重放。本轮只新增读侧能力，不新增写路径。
- **迁移 `0044_conversation_history.sql`**：`app.list_conversations(limit, cursor_at, cursor_id)`（本人 active 会话，`(created_at,id)` keyset 倒序，LATERAL 取首条用户消息作 title ≤200 字符）与 `app.list_conversation_messages(conversation_id, limit, cursor_at, cursor_id)`（归属校验失败抛 42501，排除 `deleted_at`，keyset 正序）；均为 `SECURITY DEFINER` + `app.peer_actor()` 校验，仅授予 `aven_app`；`requiredSchemaVersion` 升至 `0044_conversation_history`。
- **Contracts**：`ConversationSummary/ListQuery/ListSchema`、`ConversationMessage/MessageListQuery/MessageListSchema`（strict，keyset 双字段 refine 与时间戳 `offset: true` 照抄 notifications 模式）。
- **API**：`GET api/v1/agent/conversations`、`GET api/v1/agent/conversations/:id/messages`（`agent.controller.ts` + `agent.service.ts`，`withRequestContext` 绑定 actor，42501 → 404 不泄露归属事实）。
- **api-client**：`agent.listConversations` / `agent.listConversationMessages`（入参 safeParse + URLSearchParams，照抄 notifications 客户端）。
- **Web 状态**：`use-agent-chat.ts` 新增 `activeConversationId` 状态、`hydrationSeq` 与 `restoreConversation(id, signal)`（in-flight `pending` 锁防止发送与恢复交错；装载后配对消息为 turns，无回复的历史 turn 记为 `failed`，可「再试一次」续聊）。
- **配对纯函数 `halo/history.ts`**：`pairConversationTurns` 把扁平消息流转成 turns（用户消息+其后回复成对；孤儿回复独立保留不丢弃），4 项单测。
- **`?c=` 恢复**：`chat-page.tsx` 监听 URL 参数 → `restoreConversation` → `clearExtras`；busy 时不动运行中的回复；「新对话」清除 `?c=`；失败 toast 并在依赖变化时重试一次。
- **侧栏「最近对话」**：`app-state.tsx` 惰性加载（首载可见 loading，之后静默刷新——一个 turn 到达终态后自动刷新列表）；`app-shell.tsx` 新增 `RecentConversations`（桌面侧栏 + 移动抽屉，`/chat?c=id` 链接、当前会话 `aria-current` 高亮、折叠 72px 隐藏、错误带重试、空态文案）；动画门控：恢复的 turns 在渲染期预填 `animationState.known`（不进 fresh），重开历史不重播入场动画。
- **E2E**：新增「侧栏恢复存储会话并原地续聊」——列表渲染、`?c=` 恢复、`[data-fresh]` 不出现、后续发送复用同一 `conversationId`（desktop + mobile-web 共 2 项，路由 glob 含查询串 `?*`）。

### B. 语音听写（Web Speech API）

- **`use-speech-recognition.ts`**：feature-detect `SpeechRecognition || webkitSpeechRecognition`（本地最小类型声明）；`zh-CN`、interimResults；final 结果经纯函数 `appendDictation`（Latin/数字边界补空格、CJK 直接连写，3 项单测）写入草稿；`not-allowed` → 权限提示，`no-speech`/`aborted` 静默。
- **Composer mic 按钮**：支持浏览器 → 真实听写（listening 态 `aria-label=停止语音输入` + 强调色底与透明度脉动动画，纳入 reduced-motion 覆盖）；不支持浏览器 → 保留原「尚未开放」toast。「语音模式」（全屏语音对话）仍为诚实占位——无语音后端。

## 文件与架构

- `packages/database`：`migrations/0044_conversation_history.sql`、`src/index.ts` 版本常量。
- `packages/contracts/src/index.ts`：6 个新 Schema + 类型。
- `apps/api/src/agent/`：controller 两个 GET 端点、service 两个方法。
- `packages/api-client/src/agent.ts`：两个列表方法。
- `apps/web/src/features/personal/`：`use-agent-chat.ts`、`halo/history.ts`(+test)、`use-speech-recognition.ts`(+test)、`chat.tsx`（hydration 预填 + Composer 听写）、`pages/chat-page.tsx`（`?c=`）、`app-state.tsx`（conversations 状态 + `clearExtras`）、`halo/halo.css`（mic listening 态）。
- `apps/web/src/components/shell/`：`app-shell.tsx`（RecentConversations）、`shell.css`（侧栏最近对话样式）。
- `tests/e2e/personal-state.spec.ts`：+1 用例（2 项目）。
- `docs/database/SCHEMA.md` 8.4/9.1 节、`docs/design/DESIGN_SYSTEM.md` WEB-13 增补、本文、AGENTS.md 与 README 条目。

无组织/关系会话读取、无会话删除或重命名、无移动推送；extras（授权卡/结果卡）仍是页面本地状态，恢复会话后消失。

## 实际检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e:personal
```

- format:check、lint（含依赖边界 274 模块）、typecheck 20 任务、单测 **55 文件 / 381 项**（+2 文件 / +7 项）、完整构建 12 任务全部通过。
- 个人 Web E2E **42 项**通过（desktop + mobile-web，含新增会话历史用例）。
- **迁移验证未执行**：本机当前无 Docker / Postgres（`docker.exe` 与常见安装路径均不存在），`db:verify`（0044 空库/升级路径）与 `personal-web-verify.mjs` 真实链路无法运行。SQL 严格照抄已验证的 `0035 list_notifications` 模式（keyset、SECURITY DEFINER、peer_actor、GRANT），合并后须在具备 Docker 的环境执行 `pnpm db:verify` 补验。
- 视觉核对（生产构建 3100 端口 + 合成夹具截图）：侧栏「最近对话」三条列表与当前会话高亮 pill、恢复后的对话（气泡/行内代码/「回复完成」meta 行）均正确；恢复点击后 `[data-fresh]` 不出现。

## 已知限制与后续

- 恢复单次取 200 条消息（覆盖绝大多数会话）；更长的会话游标翻页端点已具备，界面尚未做「加载更早消息」。
- 会话标题 = 首条用户消息前 200 字符；无重命名/删除（无对应 API）。
- 听写依赖浏览器 Web Speech API（Chrome/Edge/完整版 Safari），Firefox 不可用时保持占位提示；识别结果仅写入草稿，不自动发送。
- 「语音模式」「电脑」「添加到 Slack」「定时任务」「编辑 Bot」「分享 Bot」仍为诚实占位。
- 本机未验证迁移与真实模型链路（无 Docker）；不改变 M1-07 REVIEW 与生产验收状态。
