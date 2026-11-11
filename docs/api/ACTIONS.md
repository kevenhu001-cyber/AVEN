# 行动预览与确认 API 契约

版本：1.1 · 日期：2026-11-11 · 状态：M3-06 的记忆创建行动与 M4-04 / M4-05 的机会创建行动（草稿、预览、一次性确认、权限复核、幂等执行与取消）已实现并通过真实端到端/数据库验证
相关：[API 规范](README.md) · [TDD](../architecture/TDD.md) · [SCHEMA](../database/SCHEMA.md)

所有路径带 `/api/v1/actions`，需要有效会话。Web 写请求需要 `X-CSRF-Token`；确认与取消必须提供 `Idempotency-Key`。支持 `memory.create` 与 `opportunity.create` 行动类型；发送引荐、共享档案等高影响行动在 M5 接入。

## 数据模型

- `actions`：`run_id`（可空）、`principal_id`（发起用户）、`organization_id`（可空）、`action_type`、`draft_version`、`draft_payload`、`status`、`confirmation_token_hash`、`expires_at`、`confirmed_at`、`executed_at`、`result`。
- 状态：`draft`、`pending_confirmation`、`executing`、`succeeded`、`failed`、`cancelled`、`expired`。
- 草稿创建后为 `pending_confirmation`，`draft_version=1`；确认成功为 `succeeded`，写入 `confirmed_at`/`executed_at` 与 `result`。
- `confirmation_token_hash` 只存 SHA-256；明文 token 只在创建响应返回一次。
- `draft_payload` 是受限业务数据，不写入日志、Outbox 或分析事件。

## POST /actions

- 认证：受保护；Web 需要 CSRF。
- 请求 `ActionCreateRequest`：
  - `actionType`：`memory.create` 或 `opportunity.create`。
  - `organizationId`：当 `actionType === 'opportunity.create'` 时必填，标识所属组织。
  - `payload`：
    - 若 `memory.create`：`CreateMemoryRequest`（kind/title/content/structuredValue/sensitivity/displayAudience/discoverable/allowedUses/campusId/validUntil）。
    - 若 `opportunity.create`：`CreateOpportunityDraftRequest`（title/summary/description/domains/requirements/stage/commitmentHoursPerWeek/location/remoteOk/headcount/deadline/visibility/contactUserId）。
  - `runId` 可选；若填入则校验所属 agent run。
  - `expiresInSeconds` 1–3600，默认 600。
- 成功 201 `ActionCreateResponse`：`Action` 字段 + `confirmationToken`（明文，仅此一次）。
- 草稿包含 `preview`（即 `draft_payload`）、`draftVersion`、`expiresAt`、`runId`、`organizationId`。
- 失败：`VALIDATION_ERROR` 422、`NOT_FOUND` 404（run 不属于当前主体）、`UNAUTHENTICATED` 401、`FORBIDDEN` 403（非组织成员或 CSRF 缺失）。
- 草稿创建不执行任何高影响副作用；确认才执行。

## GET /actions/:id

- 认证：受保护；仅发起用户或所属组织活跃成员。
- 成功 200 `Action`：包含 `preview`、`status`、`draftVersion`、`expiresAt`、`result` 等。
- 不返回 `confirmationToken`，也不返回 token 哈希。
- 非所有者/非组织成员/不存在返回 404。

## POST /actions/:id/confirm

- 认证：受保护；Web 需要 CSRF；必须提供 `Idempotency-Key`。
- 请求 `ActionConfirmRequest`：`{expectedDraftVersion, confirmationToken}`。
- 权限校验（M4-04 / M4-05 实时安全复核）：
  - 若为 `memory.create`：调用者必须为该行动所有者。
  - 若为 `opportunity.create`：调用者**当前必须是该组织的活跃 Owner 或 Admin**；普通 Member 或已被移出组织的用户确认严格阻断，抛出 403 `FORBIDDEN`。
- 成功 200 `Action`：状态 `succeeded`，`confirmedAt`/`executedAt` 设置，`result` 为 `{memoryId}` 或 `{opportunityId, organizationId, status: 'draft'}`；同一事务创建业务实体、更新行动与幂等结果。
- 重复确认：相同或不同幂等键都返回同一 `result`，不重复创建机会或记忆。
- 失败：
  - 403 `ACTION_TOKEN_INVALID`：token 不匹配。
  - 403 `FORBIDDEN`：无权确认组织高影响行动（非 owner/admin 或已被移出组织）。
  - 409 `VERSION_CONFLICT`：`expectedDraftVersion` 过期。
  - 409 `ACTION_EXPIRED`：草稿已过期；状态置为 `expired`。
  - 409 `ACTION_NOT_CONFIRMABLE`：已取消/失败/已执行但不可确认。
  - 404：非所有者/不存在。
  - 422：缺少幂等键或请求体非法。
- 正式执行重新校验当前用户与 run 绑定；不信任客户端传入的 principal/organization。

## POST /actions/:id/cancel

- 认证：受保护；Web 需要 CSRF；必须提供 `Idempotency-Key`。
- 成功 200 `Action`：`pending_confirmation` 变为 `cancelled`；已取消重复取消返回当前状态。
- 已执行行动返回 409 `ACTION_NOT_CONFIRMABLE`；已过期/失败行动返回当前状态，不重新执行。
- 取消不产生记忆或其他业务副作用。

## 安全边界

- `actions` 表 `FORCE ROW LEVEL SECURITY`；普通池只能读本人；写操作只通过 `SECURITY DEFINER` 函数。
- `create_action`、`get_action`、`confirm_memory_create_action`、`cancel_action` 由 `aven_function_owner` 持有，仅授予 `aven_app`。
- token 只存哈希；确认时重新计算并比较；token 不进入日志、URL 或 Outbox。
- 草稿 payload 是受限业务数据；日志只记录 route/status/request_id，不记录 payload。
- 确认执行使用当前用户上下文调用 `app.create_memory_item`，再次校验 owner、策略与字段约束。
- 幂等键绑定 principal/method/path；相同 key 不同请求返回 409 `IDEMPOTENCY_CONFLICT`。
- 草稿版本变化使旧确认失效；当前 M3-06 没有草稿编辑接口，版本固定为 1。

## 验收

- `corepack pnpm action:verify`：33 项真实 HTTP/数据库检查通过。
- 覆盖：草稿/预览、token 仅返回一次、跨用户 404、缺失幂等键、错误版本、错误 token、确认执行、记忆创建、重复确认不重复写入、token 哈希、取消/重复取消、已执行不可取消、过期拒绝、run 绑定、非法 payload/有效期、CSRF、日志不含草稿正文。
- 未验证：真实高影响行动（发布/引荐/共享）、Agent 自动提出行动、失败重试、行动过期扫描、Web/Mobile 页面与真实设备。
