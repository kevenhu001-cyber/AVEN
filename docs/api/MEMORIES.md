# 个人记忆 API 契约

版本：1.0 · 日期：2026-11-11 · 状态：M3-01 手工确认记忆的创建/读取/更新/软删除已实现并通过真实 HTTP/数据库验证
相关：[API 规范](README.md) · [TDD](../architecture/TDD.md) · [SCHEMA](../database/SCHEMA.md)

所有路径带 `/api/v1/memories`，需要有效会话；Web 写请求需要 `X-CSRF-Token`，Mobile 使用 Bearer。当前只支持所有者本人的手工确认记忆；组织记忆、候选提取、向量与共享授权未实现。

## 数据模型

- `memory_items`：所有者、类型、标题、私人正文、结构化值、敏感度、状态、有效期、版本。
- `memory_sources`：手工来源 `user_input`，记录来源版本；后续对话/文件/导入/Agent 提取来源。
- `context_field_policies`：本记忆 `content` 字段的展示受众、发现开关与 `self_ai`/`matching`/`sharing` 用途集合；缺失策略默认拒绝。
- 手工创建直接为 `confirmed`，`confirmed_at` 与 `valid_from` 为当前时间；删除为软删除 `deleted`，读取立即拒绝。

## GET /memories

- 认证：受保护；只返回本人未删除记忆。
- 查询：`limit` 1–100（默认 20）、`cursor` 不透明游标、`kind` 可选 memory kind。
- 成功 200 `MemoryListResponse`：`{data:[MemoryItem], nextCursor:string|null}`。
- 每项包含 `policy`（displayAudience/discoverable/allowedUses/campusId/version）与 `sourceCount`。
- 不返回其他用户记忆；无上下文/越权返回空或 401，不泄露存在性。

## POST /memories

- 认证：受保护；Web 需要 CSRF。
- 请求 `CreateMemoryRequest`：
  - `kind`：interest/skill/project/goal/preference/experience/education/other。
  - `title` 1–160；`content` 1–20000；`structuredValue` 可选 JSON 对象。
  - `sensitivity`：low/normal/high，默认 normal。
  - `displayAudience`：owner/campus/public，默认 owner。
  - `discoverable`：默认 false；owner-only 不能 discoverable。
  - `allowedUses`：self_ai/matching/sharing，去重；可为空（默认拒绝使用）。
  - `campusId`：campus 受众必填且必须 active；其他受众不能带 campusId。
  - `validUntil`：可选未来时间。
- 成功 201 `MemoryDetail`：包含 item、policy 与 sources（一条 `user_input` 来源）。
- 失败：`VALIDATION_ERROR` 422、`FORBIDDEN` 403、`UNAUTHENTICATED` 401。
- 副作用：同一事务创建 memory item、`user_input` source 与 `content` 字段策略；不接受客户端 owner/principal ID。

## GET /memories/:id

- 认证：受保护；仅所有者。
- 成功 200 `MemoryDetail`：item + policy + sources。
- 非所有者/不存在/已删除返回 404。

## PATCH /memories/:id

- 认证：受保护；Web 需要 CSRF；仅所有者。
- 请求 `UpdateMemoryRequest`：`expectedVersion` 必填；可更新 title/content/structuredValue/sensitivity/displayAudience/discoverable/allowedUses/campusId/validUntil。
- 成功 200 `MemoryDetail`；版本 +1，策略版本 +1。
- 版本不匹配返回 `CONFLICT` 409；非所有者/不存在返回 404。
- 合并后的策略必须满足 campus/discoverable 约束；不合法返回 422。
- `validUntil: null` 清除有效期；`structuredValue: null` 清除结构化值；`campusId: null` 清除校园。

## DELETE /memories/:id?expectedVersion=N

- 认证：受保护；Web 需要 CSRF；仅所有者。
- 成功 204；状态改为 `deleted`，`deleted_at` 设置，策略用途清空并关闭发现。
- 版本不匹配返回 409；非所有者/不存在返回 404。
- 软删除不物理删除来源/审计；后续索引清理异步执行，但读取立即拒绝。

## 安全边界

- 所有写操作通过 `app` schema 的 `SECURITY DEFINER` 函数，所有者 `aven_function_owner`；使用事务本地 `app.user_id`。
- `memory_items` 触发器要求 owner 等于当前用户且类型为 user/organization；`memory_sources`/`context_field_policies` 触发器校验来源所有权。
- `memory_items`、`memory_sources`、`context_field_policies` 均 `FORCE ROW LEVEL SECURITY`；普通池只能读本人，不能直接插入/更新记忆。
- 删除后列表/详情立即拒绝；不承诺清除已导出副本或系统外缓存。
- 当前不向组织或发现者开放原始私人记忆；后续共享必须通过字段投影与 ConsentGrant。

## 验收

- `corepack pnpm memory:verify`：27 项真实 HTTP/数据库检查通过。
- 覆盖：创建/详情/列表/分页、手工来源、策略、更新与版本冲突、软删除、跨用户读取/更新/删除拒绝、CSRF、非法受众/发现/重复用途、非法游标、RLS 隔离。
- 未验证：候选提取、确认/拒绝流程、记忆生命周期清理、组织记忆、向量、共享授权、Web/Mobile 页面与真实设备。
