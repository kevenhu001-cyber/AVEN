# 可扩展插件连接器与会话内功能小组件协议

日期：2026-11-12 · 状态：后端契约、连接器运行时、工具审计桥接、REST API 与共享客户端已实现并通过单测；真实外部开放平台凭证接入、数据库持久化配置与双端正式 UI 渲染组件（受 M1-07 设计评审门约束）仍待后续推进。

## 1. 设计原则

根据 [PRD](../product/PRD.md) 与工程安全边界约定：

1. **不运行任意第三方代码**：第一版不开放任意第三方代码沙箱，插件通过声明式 `PluginConnector` + 强类型 Zod 输入/输出契约接入服务端注册表。
2. **功能与展示解耦为声明式小组件（`ConversationWidget`）**：服务端只下发结构化 JSON 小组件载荷（不返回任意 HTML/脚本），Web 与 Mobile 在各自界面门通过后可按 `widget.kind` 原生渲染。
3. **统一工具与权限审计链**：所有插件动作自动经由 `PluginRegistry.registerToolsInto` 桥接为 `@aven/ai-core` 的 `ToolDefinition`（命名 `plugin.<pluginId>.<action>`），统一复用 `ToolExecutor` 的权限检查（`plugin:invoke:maps`、`plugin:invoke:commerce` 等）、超时控制、重试和 `ToolAuditSink` 审计。
4. **外链与跳转安全**：插件返回的外链必须经过 `SafeHttpsUrlSchema` 与 `sanitizeExternalPluginUrl` 校验，仅允许 `https://` 且命中该插件声明的 `allowedExternalHosts` 域名白名单，拒绝内网地址与嵌入式凭据；电商小组件显式携带 `requiresUserConfirmationBeforeJump: true`。
5. **Mock 与 Live 显式区分**：未配置第三方开放平台密钥或 `allowLive: false` 时统一走确定性 Mock 数据并在 `providerMode` 中明确标记 `'mock'`；当请求 `allowLive: true` 且未配置实时适配器凭据时显式失败返回 503（`PROVIDER_UNAVAILABLE`），不做静默降级欺骗。

## 2. 内置示范插件与扩展方式

默认注册表（`createDefaultPluginRegistry`）已注册 11 个可扩展插件（含外部连接器与 AVEN 原生能力），同时支持用户动态登记自定义 MCP Server：

| 插件 ID | 分类 | 支持动作 | 输出小组件类型 | 允许外链域名白名单 |
|---|---|---|---|---|
| `amap.maps` | `maps` | `search_poi`、`geocode` | `map_location_card` | `uri.amap.com`、`ditu.amap.com`、`www.amap.com` |
| `taobao.commerce` | `commerce` | `search_products` | `product_comparison_card` | `item.taobao.com`、`s.taobao.com`、`detail.tmall.com` |
| `jd.commerce` | `commerce` | `search_products` | `product_comparison_card` | `item.jd.com`、`search.jd.com` |
| `taobao_flash.commerce` | `commerce` | `search_instant_delivery` | `instant_delivery_card` | `m.tb.cn`、`market.m.taobao.com`、`s.taobao.com` |
| `meituan.lifestyle` | `lifestyle` | `search_merchants` | `local_merchant_card` | `www.meituan.com`、`i.meituan.com`、`dpurl.cn` |
| `gmail.mail` | `mail` | `search_threads`、`draft_email`、`send_email`（需 `confirmed: true`） | `email_thread_list_card`、`email_compose_preview_card` | 无外部外链 |
| `qqmail.mail` | `mail` | `search_threads`、`draft_email`、`send_email`（需 `confirmed: true`） | `email_thread_list_card`、`email_compose_preview_card` | 无外部外链 |
| `aven.social` | `social` | `preview_connection_suggestion` | `social_connection_card` | 站内能力（无外部域名） |
| `aven.calendar` | `calendar` | `suggest_meeting_windows` | `schedule_candidates_card` | 站内能力（无外部域名） |
| `aven.weather` | `lifestyle` | `forecast_commute` | `weather_travel_card` | 站内/气象样例 |
| `aven.compare` | `commerce` | `compare_offers` | `cross_platform_compare_card` | 聚合淘宝/京东/淘宝闪购白名单 |
| `mcp.<slug>`（动态） | `mcp` | `tools/list` 自动发现的所有工具 | `mcp_result_card` | 用户登记的公开 `https://` MCP 端点域名 |

### 接入新插件与自定义 MCP 的方法

1. **内置/代码级插件**：在 `packages/contracts/src/index.ts` 的 `ConversationWidgetSchema` 中定义（或复用）结构化小组件 Schema，实现 `PluginConnector` 并注册到 `PluginRegistry`。如需对接真实外部 API，在构造 `createDefaultPluginRegistry(...)` 时注入受控 HTTPS 适配器与密钥；邮件发信动作强制要求输入包含 `confirmed: true`。
2. **自定义 MCP Server**：通过 `POST /api/v1/plugins/mcp/servers` 登记外部公开 `https://` MCP 端点（严格拦截环回地址、RFC1918 内网、链路本地与云元数据网段 `169.254.*`），由 `McpPluginManager` 执行 `tools/list` 发现并按用户 `ownerUserId` 隔离挂载为 `PluginConnector`，工具输出统一收口为无脚本的只读 `mcp_result_card`；摘要接口永不回传凭据明文。

## 3. HTTP 接口契约

所有插件与 MCP 端点均挂载于 [PluginController](../../apps/api/src/plugin/plugin.controller.ts) 并受 `AuthGuard`（Web Cookie + CSRF 或 Mobile Bearer）保护，未登录返回 `401`。

### 3.1 获取已注册插件目录

- `GET /api/v1/plugins?category=maps|commerce|lifestyle|mail|calendar|social|productivity|mcp`
- 返回 `PluginCatalogResponse`：包含当前用户可见的全部内置插件与本人已登记的自定义 MCP 插件清单（名称、分类、鉴权方式、凭据状态 `mock_only`/`configured`/`missing_credentials`、允许外链域名与动作 JSON Schema）。

### 3.2 调用插件并返回功能小组件

- `POST /api/v1/plugins/:pluginId/invoke`
- 请求体（`PluginInvokeRequestSchema`）：
  - `action`：插件动作名；
  - `input`：对应动作的结构化参数；
  - `conversationId`（可选）：关联对话 ID；
  - `allowLive`（默认 `false`）：是否强制要求调用已配置的实时外部适配器。
- 响应体（`PluginInvokeResponseSchema`）：
  - `invocationId`、`pluginId`、`action`、`providerMode`（`'mock' | 'live'`）
  - `summary`：对话回复摘要文本
  - `data`：结构化业务数据
  - `widgets`：`ConversationWidget[]`（共 12 种强类型声明式卡片，包含地图地点、单平台商品比价、跨平台比价、淘宝闪购即时达、美团本地商户、邮件线程摘要、发信前确认草稿、社交推荐预览、日程协调候选、天气出行建议、行动确认预览与自定义 MCP 结构化结果）
  - `auditRef`、`executedAt`

### 3.3 自定义 MCP Server 管理

- `GET /api/v1/plugins/mcp/servers`：列出当前用户已登记的自定义 MCP 服务摘要（`hasCredential` 标记，不返回密钥）。
- `POST /api/v1/plugins/mcp/servers`：登记自定义 MCP 服务并自动发现工具（校验 `SafeHttpsUrlSchema` 与 SSRF 防护）；跨用户隔离。
- `DELETE /api/v1/plugins/mcp/servers/:serverId`：注销本人登记的自定义 MCP 服务并从注册表卸载对应动态插件（非本人返回 `403` / `404`）。

## 4. 共享客户端调用方式

`packages/api-client` 通过 `api.plugins` 暴露强类型方法：

- `api.plugins.listCatalog({ auth, category?, signal? })`
- `api.plugins.invoke(pluginId, { action, input, conversationId?, allowLive }, { auth, signal? })`
- `api.plugins.listMcpServers({ auth, signal? })`
- `api.plugins.registerMcpServer(input, { auth, signal? })`
- `api.plugins.deleteMcpServer(serverId, { auth, signal? })`

客户端按每次调用传入认证凭据、对输入/响应均做 Zod 校验，不缓存敏感业务响应。

## 5. 尚未完成范围

- **真实开放平台联调**：高德 Web Service Key、淘宝开放平台/淘宝闪购、京东联盟、美团开放平台、Gmail/QQ 邮箱 OAuth2/IMAP 以及真实远程 MCP 传输（`McpTransportAdapter`）的真实凭据与线上请求尚未接入。
- **用户级插件启停与凭据持久化表**：当前插件注册表、MCP 配置与审计处于运行期内存管理；用户自定义插件与 MCP 服务配置及加密凭据入库（参考 `calendar_connections` 隔离模式）需在数据库可用环境下新增迁移。
- **Web / Mobile 正式会话内小组件渲染**：2026-11-13 起，个人 Web 在 ADR-017 限定授权内接入了连接器选择器与 12 种声明式小组件卡片渲染（见 [WEB_03](../development/WEB_03.md)）；但正式双端设计评审仍未完成，`apps/mobile` 仍无插件入口与小组件视图，所有连接器仍只运行服务端 Mock 适配器。
