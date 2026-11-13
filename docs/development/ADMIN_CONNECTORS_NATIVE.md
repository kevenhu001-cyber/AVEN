# 管理员、Open Connector、原生与生产保障增量

日期：2026-11-13。授权依据 ADR-019；不代表完整 MVP 或生产发布验收。

## 已实现

- `/admin`：通用 OpenAI-compatible 模型和 OOMOL Project API Key 手动配置页。支持加密、不回显、版本冲突反馈、权限拒绝、页面隐藏清理和减少动态；个人账号 Sheet 增加入口。
- `/connectors`：独立真实账号授权入口，与既有 Mock 卡片区分。参考本机 Socrates `server/src/services/integrations/oomolProjectConnector.ts` 与 `routes/projectConnectors.ts`，使用相同官方 SDK 渠道。Socrates 只读，未复制其配置、凭据或业务代码。
- API 与迁移 0040–0042：平台配置、本人网关连接、配置元数据审计三表均 FORCE RLS。普通用户不能读写平台设置，当前有效管理员通过受控函数操作；原生 Bearer 客户端扩展 `loginMobile` / `meMobile`。
- 原生首页为 React Native 登录和服务器会话复核，原诊断移到 `/diagnostics`。令牌仅前台内存，后台清除并尽力撤销服务器会话，不保存明文密码或令牌。诊断加载动效读取系统减少动态设置。未改动先前未跟踪的 `apps/mobile/android/`。
- `production:preflight`：只读检查显式传入的生产环境，拒绝开发鉴权、非 HTTPS origin、弱/复用密码、缺少加密密钥、运行时数据库高权限角色及未经复核的 Live Provider。输出仅字段名，不读取开发 `.env`。5 项独立测试验证检查规则；这不是部署或备份证据。

## 使用

1. 在已有环境应用 `pnpm db:migrate`，新服务要求 `0042_platform_configuration_audit`；真实模型运行要求 `0043_agent_provider_runtime`。本开发库已应用；没有更改已应用迁移。
2. 运维在可信终端执行 `pnpm admin:role grant <已注册用户 UUID>`，赋予 7 天平台管理员资格；`revoke` 可立即撤销。命令使用 migrator 凭据，绝不能暴露为用户接口；本轮没有为任意真实用户自动提权。历史分配保留在角色表。
3. 设置已有的 `AI_USER_CONFIG_KEY`（随机 32 字节的 Base64 编码）、`AI_USER_ALLOWED_BASE_URLS`；模型地址按明确允许列表填写。密钥轮换前需备份旧密钥并安排重新加密，本轮无自动轮换功能。
4. 设置 `OPEN_CONNECTOR_ALLOWED_BASE_URLS=https://connector.oomol.com/v1` 和经管理员确认的 `OPEN_CONNECTOR_AUTH_HOSTS` 精确域名列表。在 `/admin` 保存 Project API Key，然后在 `/connectors` 发起授权。默认由管理员提供密钥；用户同日后续明确授权复用 Socrates 的现有网关密钥，按文末后续记录执行。
5. 生产候选环境显式注入 Secret Manager 的变量后执行 `pnpm production:preflight`。发布前还必须实跑迁移、API/Worker readiness、恢复演练、告警和回滚检查；脚本通过不代表已满足这些条件。

## 验证记录

- `pnpm db:migrate`：开发库新增 0040、0041、0042 成功。
- `pnpm exec tsx scripts/admin-config-verify.ts`：独立临时空库全部迁移成功，15 项权限、并发版本、密钥不回显、审计、跨用户隔离及撤权检查通过，结束后移除临时库。
- `node --test scripts/lib/production-check.test.mjs`：5 项通过。
- `pnpm lint`：通过，218 个模块、696 条依赖无违规。
- `pnpm typecheck`：20 个任务通过。
- `pnpm exec vitest run`：50 个文件、344 项通过，包含原生 Bearer 与网关身份/跳转边界测试。
- `pnpm db:verify`：空库、旧数据升级、seed 与全部数据库检查通过；检查基线更新到 43 个迁移、64 张受保护的 FORCE RLS 表（含新增平台全局表，不把它们都描述为租户表）。
- `pnpm exec turbo run build --concurrency=1`：包含移动端 JS 导出的 12 个构建任务全部通过。
- `pnpm check:expo`：通过。按 Expo 内置检查升级到 58.0.25 及其匹配的 Router/字体/链接等补丁，修复旧兼容检查失败；共享契约沿用单入口以兼容 Metro。
- `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e:personal`：桌面/手机尺寸共 16 项通过。增加页面标题、无横向溢出与页面错误检查后，管理员专项再跑 8 项通过，保存合成配置的桌面/手机截图；仅夹具，不是 Live 业务证明。
- 浏览器验证使用本机 Chrome；Browser plugin not available。未使用预览工具或操作用户已打开的页面。
- `git diff --check` 与本轮代码 Prettier 检查通过。

## 未完成

尚未进行真实 OAuth 联调；网关密钥已按用户后续授权配置到本地环境（见下节），有效性不以本地配置存在代替验证；模型 API 地址/密钥已按本地环境配置，真实推理已通过 API/Worker/SSE 验证；网关 OAuth 仍因网络不可达未联调。真实插件读取/写入、网关授权撤销、持久安全原生会话、原生对话与小组件、真机/签名发布构建、生产邮件/推送/调度/监控/备份恢复仍未完成。界面夹具 E2E 不替代真实账号或原生验证。

## 复用 Socrates 图标与现有网关配置（同日后续）

用户明确授权复用 Socrates SVG 与管理员网关密钥，依据 ADR-020。本地新增 6 个经静态检查的 SVG，来源见 `apps/web/public/connector-icons/SOURCES.md`；个人连接器目录/授权卡与独立账号连接页复用同一图标组件，其余服务保持类别图标。Socrates 保持只读。

已将现有 OOMOL Project API Key 配置到 Git 忽略的本地 `.env`（权限 0600），未输出密钥，未修改 `.env.production`。需要重启 API 进程读取新的环境配置。管理员页会显示服务器环境已配置的状态，数据库中保存的配置优先生效；保存配置损坏时不回退环境密钥。当前精确授权域名为官方网关域名，若网关返回其他合法域名，须由管理员确认后加入允许列表，不自动扩大范围。

没有自动创建任何真实授权请求或第三方账号关联；配置存在不等于 Live OAuth 已验收。未修改模型设置或平台角色。本轮增加环境配置、损坏配置拒绝及缺少跳转域名时无外部请求的回归。

本次后续验证：`pnpm lint`、`pnpm typecheck`（20 任务）、`pnpm format:check`、`git diff --check` 均通过；`pnpm exec vitest run` 为 50 文件、347 项通过；非移动端构建 11 任务通过；`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e:personal` 16 项通过，包含 SVG 实际加载和管理员环境配置状态。密钥扫描确认真实密钥未进入修改或未跟踪的非忽略文件。本次无数据库变更，无真实 OAuth 账号验收。
