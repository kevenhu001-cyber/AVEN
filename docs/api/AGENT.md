# Agent 运行时与流式 API 契约

版本：1.1 · 日期：2026-11-11 · 状态：M3-05 个人 Agent 与 M4-04 / M4-05 组织 Agent（生命周期、SSE 事件流、来源复核、多租户边界与记忆严格隔离）已实现并通过真实端到端/数据库/Worker 验证
相关：[API 规范](README.md) · [核心端点](CORE_CONTRACTS.md) · [TDD](../architecture/TDD.md) · [SCHEMA](../database/SCHEMA.md)

所有路径带 `/api/v1/agent`，需要有效会话。Web 写请求需要 `X-CSRF-Token`；SSE 使用 Cookie/Bearer，GET 不需要 CSRF。用户/组织身份由服务端会话与数据库权限函数派生，不接受客户端随意伪造主体。

## 数据模型

- `conversations`：会话（支持个人会话 `owner_user_id` 与组织会话 `organization_id`）。
- `messages`：用户输入与 AI 派生消息；AI 消息通过 `derived_from_run_id` 绑定 run。
- `agent_runs`：发起用户、所属主体（个人或组织）、会话、输入消息、状态、provider/model、摘要、错误码与取消时间。
- `agent_run_events`：按 `(run_id, sequence)` 持久化的事件；`expires_at` 默认 24 小时。
- `agent_run_sources`：输入消息与上下文来源；重放前逐项复核。
- `idempotency_keys`：按 principal/method/path 绑定幂等键与 run；默认 24 小时。

状态：`queued → running → completed|failed|cancelled`；运行中取消进入 `cancelling`，由 Worker 写入终止事件后变为 `cancelled`；排队中取消直接变为 `cancelled`。

## POST /agent/turns

- 认证：受保护；Web 需要 CSRF；必须提供 `Idempotency-Key`（1–200 字符）。
- 请求 `AgentTurnRequest`：
  - `conversationId?: uuid`
  - `organizationId?: uuid`（用于发起组织级智能协同轮次；调用者必须为该组织当前活跃成员，非成员调用返回 403 `FORBIDDEN`）
  - `input: string`（1–8000 字符）
- 成功 201 `AgentTurnResponse`：`{runId, conversationId, status:'queued', streamUrl}`。
- 组织 Agent 运行时边界（M4-04 / M4-05）：
  - Worker 挂载组织专属工具：`opportunity.search`、`organization_context.search`、`opportunity_draft.create`。
  - **绝不挂载** 任何个人记忆工具（`memory.search` 等）；`allowedUses` 不含 `self_ai`；严格禁止个人私密记忆（薪资、私人日记等）载入组织提示词。
  - 高影响动作（如创建招募机会）只以草稿形式提交 Action 提议，必须经由组织 Owner/Admin 明确确认后方可落地。
- 副作用：同一事务创建/校验会话、保存用户消息、创建 `agent_runs`、绑定输入消息来源、写入幂等结果；API 在同一事务追加 `agent.run.requested` Outbox 事件（payload 只含 run ID）。
- 同一 key + 相同请求返回同一 run；同一 key + 不同请求返回 409 `IDEMPOTENCY_CONFLICT`。
- 不存在的会话或非本人会话返回 404；输入正文不进入 Outbox、日志或分析事件。

## GET /agent/runs/:id

- 认证：受保护；仅发起用户。
- 成功 200 `AgentRun`：`{id, conversationId, status, provider, model, inputSummary, outputSummary, errorCode, cancelRequestedAt, startedAt, completedAt, createdAt, updatedAt}`。
- `inputSummary`/`outputSummary` 只保存必要元数据，不保存私人正文。
- 非所有者/不存在返回 404；事件历史过期后仍可查询终态，但不会重新生成答案。

## GET /agent/runs/:id/events

- 认证：受保护；仅发起用户。`Accept: text/event-stream`。
- 游标：`Last-Event-ID` 请求头（非负整数，缺省 0）；只重放 `sequence > cursor` 的事件，再接实时事件。
- 成功 200 SSE；每帧：
  ```text
  id: 2
  event: message.delta
  data: {"schema_version":1,"run_id":"...","sequence":2,"timestamp":"...","text":"..."}
  ```
- 事件类型：`turn.started`、`message.delta`、`tool.started`、`tool.progress`、`tool.completed`、`action.proposed`、`turn.completed`、`turn.failed`、`turn.cancelled`。
- 心跳为无 ID 注释 `: heartbeat`，每 15 秒；不分配序号、不持久化。
- 终止事件（completed/failed/cancelled）写入后流关闭；客户端按 `(run_id, sequence)` 去重。
- 失败：非法/越界游标 409 `INVALID_EVENT_CURSOR`；历史超过 24 小时 410 `EVENT_HISTORY_EXPIRED`；来源失效 409 `SOURCE_INVALIDATED`；非所有者 404。
- 重放和实时批次前都复核 run 所有者、输入消息与 `agent_run_sources` 中的记忆来源；删除/失效/撤销用途后不返回依赖正文。
- 出流后的失败使用安全终止事件，不返回内部提示词、SQL、密钥或未授权正文。

## POST /agent/runs/:id/cancel

- 认证：受保护；Web 需要 CSRF；必须提供 `Idempotency-Key`。
- 请求体为空；成功响应 `{runId, status}`。
- 排队中取消：直接 `cancelled`，写入 `turn.cancelled`，返回 202。
- 运行中取消：进入 `cancelling`，返回 202；Worker 检查取消标志/AbortSignal，写入 `turn.cancelled` 并变为 `cancelled`。
- 终态重复取消或幂等重放：返回当前状态，200；不重复写入终止事件。
- 断开 SSE 不等于取消；取消不回滚已提交或已送达外部的结果。

## 保留与维护

- `agent_run_events.expires_at` 默认 24 小时；`corepack pnpm agent:maintain` 调用 `app.purge_agent_run_events` 删除过期事件，保留 run 状态与来源。
- 事件正文是受保护业务数据，不是日志；不写入 Outbox、普通日志或分析事件。
- 来源绑定保留期覆盖事件窗口；事件过期后不能通过重放恢复正文。

## 安全边界

- 所有写操作通过 `app` schema 的 `SECURITY DEFINER` 函数；`aven_app` 只能执行用户侧函数，Worker 函数只授予 `aven_worker`。
- `conversations`/`messages`/`agent_runs`/`agent_run_events`/`agent_run_sources`/`idempotency_keys` 均 `FORCE ROW LEVEL SECURITY`；普通池只能读本人。
- 订阅/重放/取消都重新校验当前用户与来源依赖；不能把存档当作权限豁免。
- 事件 payload 只由 Worker 写入；普通池无 INSERT/UPDATE/DELETE。
- 取消传播 AbortSignal 并阻止尚未提交的动作；不承诺回滚已提交副作用。

## 验收

- `corepack pnpm agent:verify`：45 项真实 HTTP/数据库/Worker 检查通过。
- 覆盖：turn 创建/幂等冲突、queued 状态、跨用户 404、Worker 完成、SSE 事件顺序/游标/重放/非法游标、来源绑定、来源删除后拒绝重放、排队/运行中取消、实时流、24 小时过期与事件清理、日志不含正文。
- 未验证：真实 Provider、真实代理/原生 SSE、Worker 崩溃恢复租约、`tool_invocations` 持久化、行动确认（M3-06）、Web/Mobile 页面与真实设备。
