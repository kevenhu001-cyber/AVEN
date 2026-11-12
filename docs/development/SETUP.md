# 开发环境启动与故障处理

日期：2026-11-11 · 范围：M0 工程骨架；业务功能、生产部署与真实数据未开放

## 前置条件

| 项 | 要求 |
|---|---|
| Node | 24.19.0（`.nvmrc` / `.node-version`） |
| 包管理器 | Corepack 激活 pnpm 12.18.0 |
| Docker | 29.x，含 Compose v2 |
| 端口 | 3000 Web、3001 API、3002 Worker 管理、3100 E2E Web、55432 PostgreSQL、6379 Redis |
| 资源 | 建议 ≥4 GB 内存；本机 3.6 GiB 时避免同时运行全部应用 |

本机 5432 已被其他 PostgreSQL 占用，Compose 默认映射 **55432**，不要停止宿主机服务。

## 首次启动

```bash
corepack enable
corepack pnpm install --frozen-lockfile
cp .env.example .env
# 共享机器必须替换 .env 中全部开发密码
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm db:verify
corepack pnpm build
corepack pnpm check:readiness
```

`db:seed` 写入明确标记的开发样例；`db:verify` 会删除并重建 `aven_test`，只用于开发/CI。

## 日常开发

```bash
corepack pnpm infra:up          # PostgreSQL + Redis
corepack pnpm dev:api           # 127.0.0.1:3001
corepack pnpm dev:web           # 127.0.0.1:3000
corepack pnpm dev:worker        # 管理探针 127.0.0.1:3002 + 样例消费者
corepack pnpm dev:mobile        # Expo；需设置 EXPO_PUBLIC_API_URL
```

- Web 通过同源 `/health/*` 代理访问 API；内部 API 地址不暴露到浏览器。
- Expo 真机不能使用开发机 `localhost`；设置设备可达的局域网 IP 或 HTTPS origin。`API_HOST=0.0.0.0` 仅限显式开发局域网。
- 当前 Worker 只消费 `sample_task` 工程样例；业务任务未实现。
- 认证 API 已实现注册/登录/会话/验证/重置；Web/Mobile 页面尚未接入。
- 依赖就绪 200 不代表业务可用；组织/机会/引荐仍未开放。

## 检查命令

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm check:expo
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e        # 本机缺 Playwright headless shell 时加 PLAYWRIGHT_CHANNEL=chrome
corepack pnpm db:verify
corepack pnpm check:readiness
corepack pnpm async:verify    # 会短暂停止 Redis
corepack pnpm auth:verify     # 注册/登录/会话/验证/重置真实 HTTP 检查
corepack pnpm profile:verify  # 资料更新/校园成员申请真实 HTTP 检查
corepack pnpm organization:verify # 组织成员/邀请真实 HTTP 检查
corepack pnpm isolation:verify # 跨账号/跨组织与连接池隔离检查
corepack pnpm memory:verify # 个人记忆 M3-01/M3-02/M3-03 创建/复核/审计/失效/保留检查
corepack pnpm memory:maintain # 到期失效、正文保留清理与审计事件保留清理
corepack pnpm ai:verify      # Mock/OpenAI-compatible Provider 与工具权限/超时/重试/审计检查
corepack pnpm ai:eval        # 脱敏评估集与预算/阈值检查，报告写入 var/eval
corepack pnpm agent:verify   # Agent turn/SSE 重放/取消/来源复核/过期清理检查
corepack pnpm agent:maintain # Agent 事件 24 小时保留清理
corepack pnpm action:verify  # 行动草稿/预览/token/确认/幂等/取消/过期检查
```

- `db:verify`：重建 `aven_test`，验证空库迁移、已有库升级、seed 幂等、RLS 与约束。
- `check:readiness`：启动真实 API/Worker 进程，验证 API 200、Redis 故障 503、Worker 消费者就绪 200。
- `async:verify`：真实 Outbox/BullMQ 故障注入；会停止并重启 Redis，结束后恢复。
- `auth:verify`：真实 API/PostgreSQL/Redis 认证流程；开发邮件写入 `.data/mail`，不写日志。
- `profile:verify`：真实 API/PostgreSQL 资料更新与校园成员申请检查。
- `organization:verify`：真实 API/PostgreSQL 组织创建、邀请/接受、角色与离开检查。
- `isolation:verify`：跨账号/跨组织、伪造头、成员移除与连接池上下文检查。
- `memory:verify`：个人记忆创建/来源/策略/版本/软删除、候选提取/确认/拒绝、用途检索门、事件审计、到期失效、保留清理与跨用户隔离检查。
- `memory:maintain`：调用到期失效、软删除正文清理与审计事件保留清理；使用 `aven_worker`，保留天数由 `MEMORY_DELETION_RETENTION_DAYS` 与 `MEMORY_EVENT_RETENTION_DAYS` 配置。
- `ai:verify`：Mock/OpenAI-compatible Provider、结构化输出校验、工具权限/数据用途/参数伪造/超时/重试/审计检查；不连接真实 Provider，不需要密钥。
- `ai:eval`：脱敏评估集的来源支持、无依据阻断、用途/工具权限越权、记忆注入、延迟与 token/工具预算和聚合阈值检查；默认 Mock，不写入提示或正文，报告在 `var/eval`。真实 Provider 通过 `AI_PROVIDER=openai_compatible` 与 `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` 配置后执行。
- `agent:verify`：Agent turn 幂等、run 状态、SSE 事件/游标/重放、来源失效拒绝、排队/运行中取消、实时流、24 小时过期与事件清理检查。
- `agent:maintain`：调用 `app.purge_agent_run_events` 清理过期 Agent 事件；保留小时数由 `AGENT_EVENT_RETENTION_HOURS` 配置。
- `action:verify`：行动草稿/预览、一次性 token、版本/过期/错误 token、确认执行、重复确认不重复写入、取消/过期与跨用户检查。
- `test:e2e` 的测试服务器故意使用不可用依赖，验证就绪失败不会被渲染为成功。

## 故障处理

| 现象 | 处理 |
|---|---|
| `pnpm install` 报 `minimumReleaseAge` | 默认等待或改用成熟版本；ADR-018 为 SDK 58 兼容补丁列出精确版本例外，保持全局 720 分钟等待期。新增例外须说明兼容原因并更新 lockfile |
| 迁移报 `changed after it was applied` | 不要编辑已应用迁移；新增迁移修正并重新验证空库/升级 |
| `db:verify` 失败 | 查看 `aven_test` 的迁移/RLS 输出；确认 `.env` 与角色密码一致 |
| API 就绪 503 | `pnpm infra:status`；确认 PostgreSQL/Redis 健康、`pnpm db:migrate` 已执行 |
| 认证注册/重置 503 | 检查 `AUTH_DEV_MODE=true` 与 `.data/mail` 写入权限；生产邮件 Provider 尚未配置 |
| 认证登录 429 | 等待 `Retry-After`；开发测试可清理 Redis `auth:rl:*` 键 |
| Worker 就绪 503 | 确认 Redis 可用且 Worker 进程已启动消费者；查看 `worker.queue_error` 日志 |
| Redis 停止后队列不恢复 | `pnpm infra:up`；Outbox 会把未投递事件退回 pending，等待重投 |
| Playwright 缺浏览器 | `pnpm exec playwright install chromium`，或本地使用 `PLAYWRIGHT_CHANNEL=chrome` |
| Expo 真机连不上 API | 使用局域网 IP/HTTPS；检查防火墙、`EXPO_PUBLIC_API_URL` 与 API 绑定地址 |
| 端口冲突 | 修改 `.env` 的 `POSTGRES_PORT`/`REDIS_PORT`/`API_PORT`；不要停止宿主机未知服务 |
| 需要清空本地数据 | `pnpm infra:reset` 删除卷；`db:verify` 重建 `aven_test`；不可用于共享环境 |

## CI

`.github/workflows/ci.yml` 在 push 与 PR 上运行：

1. `verify`：安装、格式、lint、Expo 依赖检查、类型、单元测试、构建、Playwright E2E。
2. `infrastructure`：安装、Compose 启动、角色验证、主库迁移/seed、空库/升级验证、构建、真实就绪检查、Outbox 故障注入、关闭 Compose。

CI 使用 `.env.example` 的开发占位密码，不使用真实密钥；未执行的检查不能标为通过。CI 尚未在真实校园网络、生产数据库或 Android 设备上运行。

## 未完成

- M0-03 的 Expo Go 真机连接、原生 SSE/取消探针与 development build。
- 生产部署、备份恢复、邮件、监控告警、真实数据准入门。
- M1 设计系统与核心旅程高保真/原型。


## Android APK（GitHub Actions）

按用户指定，原生 APK 在 GitHub Actions 构建，本机不进行原生编译。操作、API origin 配置、下载和签名限制见 [WEB_ANDROID_01](WEB_ANDROID_01.md#android-apk)。`pnpm build` 中的 Android 步骤仅为 JS 导出，不是 APK。


## 事务邮件与恢复检查

开发默认 `AUTH_MAIL_TRANSPORT=file`，仅在 APP_ENV=development 且 AUTH_DEV_MODE=true 时写 `.data/mail`。部署使用 `AUTH_MAIL_TRANSPORT=smtp` 与 SMTP_HOST/PORT/SECURE/USER/PASS/FROM；465 通常使用 SECURE=true，587 使用 SECURE=false 并强制 STARTTLS。保留 TLS 校验，不把真实值放入仓库。生产不允许 file 回退。

`pnpm password-recovery:verify` 启动随机端口 API、显式 file sink 与独立限流盐，验证密码恢复与旧会话撤销，不清除线上限流记录或发送外部邮件。真实 SMTP 的连接认证和实际收件箱送达分别验收。
