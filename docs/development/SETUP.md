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
- 依赖就绪 200 不代表业务可用；业务 API、认证、组织/机会/引荐仍未开放。

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
```

- `db:verify`：重建 `aven_test`，验证空库迁移、已有库升级、seed 幂等、RLS 与约束。
- `check:readiness`：启动真实 API/Worker 进程，验证 API 200、Redis 故障 503、Worker 消费者就绪 200。
- `async:verify`：真实 Outbox/BullMQ 故障注入；会停止并重启 Redis，结束后恢复。
- `test:e2e` 的测试服务器故意使用不可用依赖，验证就绪失败不会被渲染为成功。

## 故障处理

| 现象 | 处理 |
|---|---|
| `pnpm install` 报 `minimumReleaseAge` | 不要绕过供应链等待期；改用已成熟版本并记录，或等待后重试 |
| 迁移报 `changed after it was applied` | 不要编辑已应用迁移；新增迁移修正并重新验证空库/升级 |
| `db:verify` 失败 | 查看 `aven_test` 的迁移/RLS 输出；确认 `.env` 与角色密码一致 |
| API 就绪 503 | `pnpm infra:status`；确认 PostgreSQL/Redis 健康、`pnpm db:migrate` 已执行 |
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
