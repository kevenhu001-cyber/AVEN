# 个人聊天工作区重做

日期：2026-11-13。用户提供四张 Grok Bot 聊天、动态、目标与内容页截图，要求简化输入、改善回复展示，并学习 Socrates 的 UI 特点。APK 继续暂停。

## 设计与范围

读取 Socrates 的 `frontend/src/styles/components/chat.css`、`styles/parity/composer-unified.css`、`styles/polish/composer.css` 与 `styles/legacy/06-chat-transcript.css`，采用其消息与输入同宽、16px/26px 正文、轻量操作栏、上翻时保留阅读位置等方式；不改动 Socrates。先补充 DESIGN_SYSTEM 与 AGENT 契约，再实现。

工作区改为纯黑画布、深灰气泡、白色发送键和统一线性图标。手机为顶部角色身份、正文、底部输入与五入口；桌面为左侧导航和最大 720px 阅读列。去除重复状态角色、常驻工程标记与完成提示，把状态集中在必要位置；角色使用静态 SVG，无发光、渐变、阴影或循环动效。欢迎/注册界面本轮不重做。

五个入口是对话、记忆、连接、通知、更多。辅助页面进入主内容区；更多提供历史、连接器、账号与安全入口。复用真实现有服务，不伪造截图中的资讯、目标追踪、文件或影音库。记忆新增表单按需展开，历史与记忆提供新的空状态；恢复、连接、通知、资料及安全权限仍按既有接口执行。

## 功能变化

- 输入框仅保留加号、消息与发送/停止。支持中文组合输入、Enter 发送、Shift+Enter 换行和自适应高度；视口声明 `resizes-content` 供支持的手机浏览器调整软键盘空间。
- 当前聊天树切换页面时保持挂载，保留对话、草稿与流。新对话清空本页线程和连接器结果，不删除服务端历史；有未确认结果或运行中的请求时禁用。
- 文本支持安全的段落、列表、强调、引用、行内代码与围栏代码块，回复与代码可复制；HTML 和 URL 只作为文本，不执行 HTML 或内嵌脚本。此为明确的小型 Markdown 子集，未实现表格、数学公式和附件。
- 用户上翻时不抢滚动，新增内容可用“回到最新消息”定位。聊天与连接器结果按本页时间顺序排列。
- 源/HTTP 失败清除派生正文；未知创建结果同幂等键手动核对，断流从安全游标重读。会话暂停立即隐藏私人视图、清除连接器结果；聊天派生正文仍需服务端复核后显式重读，不能以本地结果绕过权限。
- Mock 从单句固定文本扩展为问候、规划、记忆、连接器及未知问题的确定性示例。只用当前无 name 的 user 消息选择模板，不读取/回显检索上下文；显式 `mockText` 覆盖仍有效。每个分支说明 Mock 或能力边界，不冒充邮箱、日历已连接或外部动作已执行。

真实模型尚未启用。模板不是推理能力、多轮理解或智能任务完成证据；本轮已向用户询问是否允许沿用 Socrates 模型配置，收到明确授权前保持 Mock。

## 文件与架构

工作区与导航：`workspace.tsx`、`workspace-navigation.ts`、`workspace.css`、`modal.tsx`、`icon.tsx`。聊天与格式：`chat.tsx`、`use-agent-chat.ts`、`message-format.ts`、`message-content.tsx`。页面组合：`memories-panel.tsx`、`history-panel.tsx`。网页视口：`app/layout.tsx`、`app/page.tsx`。模拟内容：`packages/ai-core/src/mock-chat-reply.ts`、`mock-provider.ts`。

仍是 Web → api-client → API，Worker 通过统一 AIProvider 流出文本；无数据库迁移、新 HTTP/SSE 字段、真实 OAuth/MCP、模型配置或密钥变化。Vite 测试解析增加 Web `@` 别名，以直接测试真实工作区组件。旧 Web 浏览器脚本调整导航/全页返回/完成复制按钮选择器，但本轮没有执行这些脚本。

## 实际验证

| 检查 | 结果 |
|---|---|
| `corepack pnpm test` | 58 个文件、371 项通过；随后新增连接器顺序/暂停清除测试，工作区定向 5 项通过 |
| `corepack pnpm typecheck` | 20 个任务通过 |
| `corepack pnpm lint` | 通过，239 个模块 / 769 个依赖无边界违规 |
| `corepack pnpm build:packages` | 8 个任务通过 |
| `corepack pnpm --filter @aven/worker build` | 通过 |
| `corepack pnpm --filter @aven/web build` | 通过，构建包含 TypeScript 校验 |
| `corepack pnpm exec tsx scripts/chat-workspace-verify.ts` | 11 项真实 HTTP/数据库/Worker/SSE 检查通过：合成注册/登录、建轮、同键复用、终态、结构化 Mock、无外部动作声明、重放一致、跨账号 404 |
| 工作区 React 交互 | 导航保留对话与草稿、不重发、复制实际回复、新对话清空、暂停隐藏与显式重读、连接器顺序与清除通过 |
| 安全格式测试 | 原始 HTML/JS URL 为文本，未闭合代码可流式显示，HTML 输出转义通过 |

运行 `corepack pnpm chat-workspace:verify` 前需已迁移的开发 PostgreSQL/Redis，以及使用当前构建、默认 Mock 的 Worker。脚本启动独立 API，以随机账号和 IP salt 使用本地邮件文件，不发送外部邮件、不清除全局频控；日志只打印检查标签，不打印正文或凭据。

本轮证据是组件交互、SSR 安全输出与真实接口链路；没有新的浏览器截图、布局测量、软键盘、屏幕阅读器或真机验收。生成的设计概念不能替代这些检查，不能宣称视觉已正式验收或与截图逐像素一致。M1-07 仍 REVIEW，真实模型、外部服务、M7 生产门不因本轮关闭。

## 部署记录

已构建并重启本机 aven-web 与 aven-worker；aven-api 保持运行，三项服务均 active。公网 https://aven.topodrive.top 返回 200，页面包含深色主题色与 resizes-content 视口声明。没有发送外部邮件、调用真实模型或运行 Android 构建。
