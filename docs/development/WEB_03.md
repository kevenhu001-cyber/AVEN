# WEB-03：连接器调用与会话小组件接入个人 Web

日期：2026-11-13。沿用 [ADR-017](../architecture/decisions/0017-personal-web-increment.md) 的个人 Web 限定授权，补齐 [系统状态](SYSTEM_STATUS.md) 中 P0「插件和会话小组件待补齐」的产品界面缺口。插件后端协议、目录与工具审计桥接在 [PLUGINS_WIDGETS.md](../api/PLUGINS_WIDGETS.md) 已交付；本轮只做 Web 侧接入，**没有接入真实外部开放平台凭据、真实远程 MCP 传输、真实邮箱或第三方账号**，M1-07 整体仍为 REVIEW。

## 已实现

- **对话内连接器入口**：聊天输入区新增连接器按钮，打开后按类别（地图、购物、生活、邮箱、社交、日程）列出服务端目录的全部 11 个内置连接器，展示名称、说明、只读/可写入标记与凭据状态（仅 Mock / 缺少凭据 / 已配置）。目录来自真实接口 `GET /api/v1/plugins`，不在前端硬编码。
- **按动作调用**：每个连接器列出其动作（如「地点与地址检索」「检索邮件摘要」「会话内日程协调卡片」）。选中动作后按服务端下发的 `inputJsonSchema` 动态生成表单（文本、数字、布尔、枚举、数组），必填项未填写时禁止调用。调用固定走 `allowLive: false`，界面标注「调用（Mock 模式）」。
- **会话小组件渲染**：调用成功后，结果以小组件卡片渲染进对话流，支持全部 12 种声明式小组件：`map_location_card`、`product_comparison_card`、`schedule_candidates_card`、`action_preview_card`、`email_thread_list_card`、`email_compose_preview_card`、`instant_delivery_card`、`local_merchant_card`、`social_connection_card`、`cross_platform_compare_card`、`weather_travel_card`、`mcp_result_card`。每张卡片都显示数据来源模式徽标（Mock / 实时）。
- **外部跳转需确认**：小组件中的外部链接不会直接打开，先显示「打开…（需你确认）」，点击后才展示真实地址并由用户主动跳转；邮件草稿卡片显式标注发送需要确认；日程卡片显式标注未修改任何外部日历。
- **可测试的表单逻辑**：连接器表单的默认值、必填判定与输入构造抽为纯函数 `plugin-input.ts`，新增 5 项单元测试；`vitest.config.ts` 的测试范围扩展到 `apps/web/src/**/*.test.ts`，Web 侧首次纳入单测。

## 架构与安全

- Web 仍只经同源重写访问 API，直接复用 `packages/api-client` 既有 `plugins.listCatalog` / `plugins.invoke`，未新增客户端方法、未新增依赖、未新增数据库迁移、未改动服务端权限模型。
- 调用沿用服务端既有的插件权限、审计与超时机制：用户调用只获得默认插件权限集合，工具调用会写审计引用，Mock 与实时由服务端适配器决定，Web 端不能自行切换到实时模式。
- 目录中的凭据状态由服务端判定，界面只如实展示，不伪造“已连接”。
- 写类动作（邮件起草/发送）当前只有 Mock 适配器，界面明确标注“草稿预览 / 需要你确认”，不冒充真实发送。
- 不把插件结果写进记忆或共享用途；连接器结果只存在于当前页面会话内，与聊天正文一样刷新即消失。

## 验证

新增 `scripts/personal-web-connector-verify.mjs`（Playwright + 真实 API/PostgreSQL/Redis 合成账号），并注册为 `pnpm personal-web:verify:connector`。

| 检查 | 结果 |
|---|---|
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm lint` | 通过；200 个模块、634 条依赖无边界违规 |
| `corepack pnpm typecheck` | 20 个任务通过 |
| `corepack pnpm test` | 46 个文件、313 项通过（新增 Web 端 5 项） |
| `corepack pnpm build` | 12 个任务通过 |
| `pnpm personal-web:verify:connector` | 8 项通过：目录按类别列出内置连接器、凭据状态区分「缺少凭据/仅 Mock」、地图小组件带 Mock 标签渲染进对话、外部导航链接需二次确认、日程小组件声明未修改外部日历、目录由真实接口提供、浏览器无未捕获错误；截图写入 `var/design/personal-web-connector/` |
| `pnpm personal-web:verify` | 18 项通过（WEB-01 回归） |
| `pnpm personal-web:verify:review` | 12 项通过（WEB-02 回归） |
| `pnpm personal-web:verify:recovery` | 7 项通过（会话恢复回归） |
| `corepack pnpm check:expo` | 仍失败：9 个 Expo 依赖低于推荐兼容版本；本轮未改移动端依赖 |

复跑方式（需要 Compose 依赖与已构建 API/Worker/Web）：

```bash
corepack pnpm build
corepack pnpm personal-web:verify:connector
```

脚本只允许 `127.0.0.1`/`localhost`，复用 WEB-02 的合成账号，不重建数据库、不清除全局限流；`.data/personal-web-connector-*` 为合成夹具，已被 Git 忽略。

## 限制与下一步

- 全部连接器当前只运行服务端 Mock 适配器，返回的是样例数据；真实高德/淘宝/京东/美团/闪购/Gmail/QQ 邮箱凭据与实时适配器未接入。
- 自定义 MCP 服务器只能在服务端注册与调用，Web 侧没有注册/管理界面，也没有真实远程 MCP 传输。
- 连接器结果只渲染在当前会话视图，没有历史列表、没有导出，也不能作为记忆或共享用途保存。
- 社交连接小组件只是连接器协议的一种呈现，真实连接邀请仍走个人连接流程（连接码 + 共享预览 + 双方决定）。
- 下一项可独立推进的工作：M5-02 pgvector 语义召回、或 M6-02 真实日历适配器与 `0039` 迁移实库回归；两者都需各自满足数据发送与验证门。
