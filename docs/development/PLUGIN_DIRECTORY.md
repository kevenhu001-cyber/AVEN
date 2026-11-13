# 插件目录、详情页与 SVG 扩充

日期：2026-11-13。用户要求“做出更多的 SVG 和插件页面”。沿用现有页面设计令牌、插件 API、Mock 范围与 ADR-020 的本地 SVG 来源规则。

## 已实现

- 新增 `/plugins` 目录页与 `/plugins/[id]` 详情页，个人账号 Sheet 与账号连接页增加入口，导航辅助脚本同步增加 `openPluginDirectory`。
- 目录从既有鉴权 API 读取实际插件，支持关键词、分类、可用状态筛选、无匹配提示、重试与登录提示。详情展示实际动作、数据边界与提供方，复用已有 ActionForm 和 WidgetCard 调用/展示 Mock 结果，固定 `allowLive:false`。
- 增加 Slack、GitLab、Discord、Todoist、滴答清单、飞书、arXiv、Zotero、百度地图 9 项扩展服务介绍与详情。明确显示“即将开放”，无授权或执行按钮，不向服务端注册假插件。
- 新增 11 个来自 Socrates 的本地品牌 SVG，以及 6 个 AVEN 原创功能 SVG（天气、比价、社交、日程、购物、MCP）；加上此前 6 个，本地共 23 个 SVG。来源在 `apps/web/public/connector-icons/SOURCES.md`。购物图标为通用功能标识，不冒充淘宝、京东等品牌 Logo。
- 响应式目录、键盘焦点、卡片/详情轻量过渡与减少动态支持。会话正文/调用结果只在本页内存中保留，页面隐藏或离线时清除并中止读取。

无新增依赖、API、迁移、真实第三方动作或原生页面。已有管理员密钥设置不变，不进行真实 OAuth 自动授权。

## 验证

- `pnpm lint`：223 个模块、707 条依赖，无违规。
- `pnpm typecheck`：20 任务通过。
- `pnpm exec turbo run build --filter='!@aven/mobile' --concurrency=1`：11 任务通过。
- `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e:personal`：桌面与手机尺寸 24 项通过，覆盖目录搜索/分类/空态、详情 Mock 调用、未来服务无调用入口、图标加载、401 隐藏、离线恢复及手机无横向溢出。初次发现测试定位命中 Next.js 播报区和路由切换前状态，限定目录区域并等待详情 URL 后复验通过。
- `pnpm exec vitest run`：50 文件、347 项通过。
- `pnpm format:check` 与 `git diff --check`：通过。
- 增加联网恢复处理后重新运行 lint、类型与 Web 构建，均通过；已检查桌面和手机目录合成截图。

浏览器夹具仅使用合成目录和结果，不代表真实插件联调或完整产品验收。截图为目录夹具，未使用真实账号资料。
