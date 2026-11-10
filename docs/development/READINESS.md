# M0-06 服务可用性与就绪检查

日期：2026-11-11 · 状态：API/Worker 存活与就绪、Web/Expo 探针调用已验证；M0-07 样例消费者已接入，业务接口未实现

## 范围

本轮区分存活与就绪：存活只证明进程可处理请求；就绪检查 PostgreSQL、Redis、迁移版本，Worker 另检查队列消费者。API/Worker 共用 `@aven/service-health` 探针包；Web/Expo 工程页调用真实 HTTP 探针。未实现认证、业务 API、生产队列运维、限流或生产编排。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/service-health` | API/Worker 共享探针：短生命周期 PostgreSQL 池、Redis 连接、2 秒超时、统一结果 |
| `packages/contracts` | `ReadinessChecksSchema`、`ReadinessResponseSchema` |
| `packages/api-client` | `getReadiness()`；`ApiClientError.apiCode` 保留服务端错误码 |
| `apps/api` | `/health/ready` 调用真实依赖；失败统一 503；关闭时释放探针连接 |
| `apps/worker` | 管理端口 `/health/ready` 检查依赖与消费者；M0-07 样例消费者运行时就绪 200，未运行则 503 |
| `apps/web` / `apps/mobile` | 存活与依赖就绪两个独立检查，失败不渲染为成功 |
| `scripts/check-readiness.mjs` | 真实进程/真实依赖的 200/503 验证 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm check:readiness` | 通过；API 就绪 200（database/redis/migrations 均 true）、Redis 端口错误时 503 且 retryable、Worker 存活 200、Worker 就绪 200（consumers=true） |
| `corepack pnpm test` | 45/45 通过；新增 readiness 契约、API 200/503、Worker 200/503、客户端 `getReadiness` 与 `apiCode` |
| `corepack pnpm test:e2e` | 6/6 通过；Web 存活成功、就绪失败不渲染为成功、桌面/Pixel 7 无横向溢出 |
| `corepack pnpm typecheck` | 16/16 Turbo tasks 通过 |
| `corepack pnpm build` | 10/10 Turbo tasks 通过 |
| `corepack pnpm db:verify` | 36 项数据库检查通过；新增 `0004` 迁移授予只读版本查询 |

## 行为

- `GET /health/live`：200，`service=api|worker`，不访问依赖。
- `GET /health/ready`：
  - API：`database && redis && migrations` 才 200；否则 503 `SERVICE_NOT_READY`、`retryable=true`。
  - Worker：额外要求 `consumers=true`；M0-07 样例消费者运行时就绪 200，消费者未运行或 Redis 不可用时 503。
- 失败响应不包含数据库地址、Redis URL、SQL、堆栈或迁移内容；请求 ID 与响应头一致。
- Web/Expo 分别显示“API 进程可访问”和“依赖已就绪”；依赖失败显示“依赖尚未就绪”，不显示成功文案。
- 探针使用 2 秒超时；API 关闭时释放连接；Redis 客户端禁用离线队列与自动重试，避免探针挂起。

## 已知限制

- Worker 只有 M0-07 样例消费者；业务队列、死信运维与指标未实现。
- 未实现限流、认证、依赖熔断、缓存或指标；探针每次检查会建立短生命周期连接。
- 未验证生产编排、Kubernetes probe、TLS、跨网络延迟或数据库故障切换。
- 未实现业务 API、认证、组织/机会/引荐；就绪 200 不代表业务可用。
- Expo 真机未连接；Web E2E 不能替代原生验证。
