# M3-05 运行时与流式

日期：2026-11-11 · 状态：Agent turn 创建、run 状态、持久事件、SSE 重放、取消、来源复核与 24 小时清理已实现并通过真实 HTTP/数据库/Worker 验证；真实 Provider、真实代理/原生流、Worker 崩溃恢复与行动确认未实现

## 范围

本轮建立个人 Agent 运行时：`POST /agent/turns` 幂等创建会话/消息/run/来源/Outbox；Worker 消费 `agent.run.requested`，调用 Mock Provider 与 `memory.search` 工具，持久化 `turn.started`、`tool.*`、`message.delta`、`turn.completed`；`GET /agent/runs/:id/events` 支持 `Last-Event-ID` 重放、实时轮询、心跳、来源复核和 24 小时过期；`POST /agent/runs/:id/cancel` 支持排队/运行中取消与终态幂等。未实现 M3-06 行动确认、M3-07 页面/评估、真实 Provider 网络或原生 SSE 验证。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0015_agent_runtime.sql` | 会话/消息/run/事件/来源/幂等表、状态与事件枚举、FORCE RLS、15 个 Agent 函数与授权 |
| `packages/contracts/src/index.ts` | Agent turn/run/event/cancel Schema、`SOURCE_INVALIDATED` 错误码 |
| `apps/api/src/agent/*` | turn 创建、run 查询、SSE 事件流、取消、幂等与来源复核 |
| `apps/worker/src/agent.ts` | Worker 运行时：Mock Provider 流式、memory.search、来源绑定、取消轮询、终止事件 |
| `apps/worker/src/outbox.ts` | 按 event_type 路由 Outbox，支持 Agent 队列自定义入队 |
| `apps/worker/src/runtime.ts` | `aven-agent` 队列/Worker、Provider 配置、双消费者就绪 |
| `scripts/agent-verify.ts` | 45 项真实 HTTP/数据库/Worker/SSE 检查 |
| `scripts/agent-maintenance.ts` | `agent:maintain` 事件保留清理 |
| `docs/api/AGENT.md` | 1.0 端点、SSE、取消、错误与保留契约 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm agent:verify` | **45/45 通过**；turn/幂等/SSE/游标/来源失效/取消/实时流/过期清理 |
| `corepack pnpm db:verify` | **121 项数据库检查通过**；15 个迁移、29 张表 FORCE RLS、15 个 Agent 函数所有权与角色权限 |
| `corepack pnpm test` | **104/104 通过**（新增 Agent contracts 测试） |
| `corepack pnpm typecheck` | **20/20 Turbo tasks 通过** |
| `corepack pnpm lint` | 通过；无依赖边界违规 |
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm build` | **12/12 Turbo tasks 通过** |
| `corepack pnpm async:verify` | 29/29 通过；Outbox/BullMQ 样例未回归 |
| `corepack pnpm check:readiness` | API/Worker 双消费者就绪检查通过 |

关键安全断言：

- turn 创建必须提供 `Idempotency-Key`；同 key/同请求返回同一 run，同 key/不同请求返回 409 `IDEMPOTENCY_CONFLICT`。
- 输入正文只写入受保护 `messages`，不进入 Outbox、日志或分析；Outbox payload 只含 run ID。
- 事件先持久化再发送；`(run_id, sequence)` 主键、每 run 单调序号、最多一个终止事件。
- SSE 只重放 `sequence > Last-Event-ID` 的事件；非法/越界游标 409，超过 24 小时 410，非所有者 404。
- 重放前复核 run 所有者、输入消息与 `agent_run_sources`；删除记忆或撤销用途后返回 409 `SOURCE_INVALIDATED`，不返回依赖正文。
- 取消排队 run 立即写 `turn.cancelled`；取消运行中 run 进入 `cancelling`，Worker 通过取消轮询/AbortSignal 停止并写终止事件；终态重复取消幂等。
- 普通池不能直接插入/更新 Agent 表；Worker 函数只授予 `aven_worker`；SSE/日志不含系统提示词、私人正文或密钥。
- `agent:maintain` 只清理过期事件，保留 run 终态与来源。

## 已知限制

- 未接入真实 Provider；Worker 默认 Mock，真实网络成功/限流/超时/取消未验证。
- 未验证真实反向代理的 SSE 缓冲/缓存、Web fetch 流和原生 fetch/AbortController；M3-05 只验证 Node HTTP 客户端。
- Worker 崩溃后 `running` run 的租约/恢复未实现；当前依赖 BullMQ 重试与终态幂等，未提供 stale run 清理。
- `tool_invocations`/`agent_steps` 表未落库；工具审计目前写入结构化日志与 run 事件，不含参数/结果正文。
- 未实现行动预览/确认（M3-06）、真实 Provider 评估集（M3-07）、Web/Mobile 页面或真实设备。
- 未实现组织/关系会话；当前只启用个人会话。
- 未验证高并发 SSE 订阅、多实例 Worker、事件积压或大数据量清理。

## 下一步

- M3-06：行动预览与确认，绑定草稿版本、有效期和一次性执行标识；重复确认不重复写入。
- M3-07：个人页面、记忆复核 UI、脱敏评估集与预算/阈值。
- 真实 Provider、代理/原生 SSE、Worker 崩溃恢复与 `tool_invocations` 持久化在后续阶段补验。
