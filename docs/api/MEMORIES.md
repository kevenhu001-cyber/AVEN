# 个人记忆 API 契约

版本：1.2 · 日期：2026-11-11 · 状态：M3-01 手工确认记忆、M3-02 候选复核与 M3-03 生命周期审计/失效/保留已实现并通过真实 HTTP/数据库验证
相关：[API 规范](README.md) · [TDD](../architecture/TDD.md) · [SCHEMA](../database/SCHEMA.md)

所有路径带 `/api/v1/memories`，需要有效会话；Web 写请求需要 `X-CSRF-Token`，Mobile 使用 Bearer。当前只支持所有者本人的记忆；组织记忆、向量、共享授权与真实 AI 提取未实现。

## 数据模型

- `memory_items`：所有者、类型、标题、私人正文、结构化值、敏感度、状态、有效期、版本。
- `memory_sources`：来源类型 `user_input`/`conversation`/`file`/`import`/`agent_extraction`，记录来源 ID、版本与最小片段。
- `context_field_policies`：本记忆 `content` 字段的展示受众、发现开关与 `self_ai`/`matching`/`sharing` 用途集合；缺失策略默认拒绝。
- `memory_events`：只追加的生命周期审计，记录事件类型、状态转换、版本、actor 类型与受限 metadata；不保存标题、正文、结构化值或来源片段。
- 手工创建直接为 `confirmed`；提取只创建 `pending_confirmation` 候选。确认后为 `confirmed`，拒绝后为 `rejected`；到期为 `expired`；删除为软删除 `deleted`，读取立即拒绝。
- 候选确认/拒绝使用 `expectedVersion` 乐观锁；确认可同时修改标题、正文、类型、敏感度、受众、用途与有效期。

## 状态与检索范围

```text
pending_confirmation --confirm--> confirmed --expire--> expired --delete--> deleted
pending_confirmation --reject---> rejected  --delete--> deleted
confirmed            --delete--> deleted
expired              --delete--> deleted
```

- 到期由 `app.expire_due_memories` 在维护任务中执行；`valid_until` 已到的 confirmed 记忆转为 `expired`，用途清空并关闭发现。
- 主列表 `GET /memories` 只返回 `confirmed` 且未删除的记忆。
- 候选队列 `GET /memories/candidates` 只返回 `pending_confirmation`。
- 检索范围 `GET /memories/usable?use=...` 只返回 `confirmed`、未删除、未过期且策略明确包含该用途的记忆。
- `pending_confirmation`、`rejected`、`expired` 与用途为空的记忆不会进入任何检索范围；`sharing` 用途只表示允许进入共享流程，不代表已实际共享。

## GET /memories

- 认证：受保护；只返回本人 `confirmed` 未删除记忆。
- 查询：`limit` 1–100（默认 20）、`cursor` 不透明游标、`kind` 可选 memory kind。
- 成功 200 `MemoryListResponse`：`{data:[MemoryItem], nextCursor:string|null}`。
- 每项包含 `policy`（displayAudience/discoverable/allowedUses/campusId/version）与 `sourceCount`。
- 不返回候选、已拒绝或已删除记忆；无上下文/越权返回空或 401，不泄露存在性。

## GET /memories/candidates

- 认证：受保护；只返回本人 `pending_confirmation` 候选。
- 查询：`limit` 1–100（默认 20）、`cursor` 不透明游标。
- 成功 200 `MemoryCandidateListResponse`：`{data:[MemoryCandidate], nextCursor:string|null}`。
- `MemoryCandidate` 在 `MemoryItem` 基础上增加 `source`（首个来源的 type/id/version/excerpt/createdAt，可为 null），用于复核来源。
- 候选默认 `displayAudience=owner`、`discoverable=false`、`allowedUses=[]`；确认前不进入主列表或检索范围。

## POST /memories/extract

- 认证：受保护；Web 需要 CSRF。
- 请求 `ExtractMemoryRequest`：
  - `text` 1–20000。
  - `sourceType`：`conversation`/`file`/`import`/`agent_extraction`，默认 `agent_extraction`；不接受 `user_input`。
  - `sourceId` 可选 UUID；`sourceVersion` 可选 1–120 字符。
- 成功 201 `ExtractMemoryResponse`：`{extractor:'mock_rules_v1', data:[MemoryCandidate]}`。
- 当前提取器是**确定性规则 Mock**，只识别带标签的行（如 `兴趣：具身智能`、`技能：ROS 2`、`项目：校园服务机器人`），最多 20 条；没有匹配时返回空数组，不编造候选。真实 Provider 在 M3-04 接入。
- 同一用户、类型、标题、正文的重复提取返回同一 pending 候选，不重复写入；确认/拒绝后再次提取会创建新的 pending 候选。
- 副作用：同一事务创建 pending item、来源与 owner-only 空用途策略；不接受客户端 owner/principal ID。

## POST /memories/:id/confirm

- 认证：受保护；Web 需要 CSRF；仅所有者。
- 请求 `ConfirmMemoryRequest`：`expectedVersion` 必填；可选 `kind`/`title`/`content`/`structuredValue`/`sensitivity`/`displayAudience`/`discoverable`/`allowedUses`/`campusId`/`validUntil`，用于“修改后确认”。
- 成功 200 `MemoryDetail`：状态 `confirmed`，版本 +1，`confirmedAt` 设置，策略版本 +1。
- 只允许 `pending_confirmation`；已确认/已拒绝返回 409；版本不匹配返回 409；非所有者/不存在返回 404。
- 合并后的策略必须满足 campus/discoverable 约束；不合法返回 422。允许 `allowedUses=[]`，但该记忆不会进入检索范围。

## POST /memories/:id/reject

- 认证：受保护；Web 需要 CSRF；仅所有者。
- 请求 `RejectMemoryRequest`：`{expectedVersion}`。
- 成功 200 `MemoryDetail`：状态 `rejected`，版本 +1，策略用途清空并关闭发现。
- 只允许 `pending_confirmation`；已确认/已拒绝返回 409；非所有者/不存在返回 404。
- 拒绝后不能通过 PATCH 恢复为可用记忆；需要重新提取或手工创建。

## GET /memories/usable

- 认证：受保护；仅本人。
- 查询：`use` 必填，`self_ai`/`matching`/`sharing`；`limit` 1–100（默认 20）、`cursor`。
- 成功 200 `MemoryListResponse`：只包含 `confirmed`、未删除、未过期且策略 `allowedUses` 包含该用途的记忆。
- 这是 AI/匹配/共享读取个人记忆的显式门；`pending_confirmation`、`rejected`、`expired` 和空用途记忆一律不返回。

## GET /memories/:id/events

- 认证：受保护；仅事件所有者。
- 查询：`limit` 1–100（默认 20）、`cursor` 不透明游标。
- 成功 200 `MemoryEventListResponse`：`{data:[MemoryEvent], nextCursor:string|null}`。
- `MemoryEvent`：`id`、`eventType`（created/candidate_created/confirmed/rejected/updated/expired/deleted/purged）、`actorType`（user/system）、`fromStatus`/`toStatus`、`version`、`metadata`、`createdAt`。
- 事件按 `createdAt` 倒序；软删除或已物理清除正文的记忆仍可读取其审计事件，只要事件仍在保留期内。
- 非所有者返回空数组，不泄露记忆或事件存在性。
- `metadata` 只允许受控键（reason/sourceType/allowedUses/displayAudience/changedFields/retentionDays），不包含标题、正文、结构化值或来源片段。

## 生命周期与保留

- `app.expire_due_memories`：把 `valid_until <= clock_timestamp()` 的 confirmed 记忆转为 `expired`，清空用途并关闭发现；由维护任务调用。
- `app.purge_deleted_memories`：硬删除软删除超过保留期（默认 30 天）的记忆、来源与字段策略；审计事件保留。
- `app.purge_memory_events`：删除超过审计保留期（默认 365 天）的事件；与正文保留策略独立。
- 维护命令：`corepack pnpm memory:maintain`，使用 `aven_worker` 调用上述三个函数；保留天数由 `MEMORY_DELETION_RETENTION_DAYS` 与 `MEMORY_EVENT_RETENTION_DAYS` 配置。
- 当前没有 `memory_embeddings`/pgvector 索引；语义索引启用后，删除/失效必须在同一失效路径清理对应向量，读取仍以主库状态与用途策略为准。

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
- 候选、已确认、已拒绝均可由本人读取；非所有者/不存在/已删除返回 404。

## PATCH /memories/:id

- 认证：受保护；Web 需要 CSRF；仅所有者。
- 请求 `UpdateMemoryRequest`：`expectedVersion` 必填；可更新 title/content/structuredValue/sensitivity/displayAudience/discoverable/allowedUses/campusId/validUntil。
- 成功 200 `MemoryDetail`；版本 +1，策略版本 +1。
- 只允许 `pending_confirmation` 与 `confirmed`；`rejected`/`expired` 返回 409。
- 版本不匹配返回 `CONFLICT` 409；非所有者/不存在返回 404。
- 合并后的策略必须满足 campus/discoverable 约束；不合法返回 422。
- `validUntil: null` 清除有效期；`structuredValue: null` 清除结构化值；`campusId: null` 清除校园。

## DELETE /memories/:id?expectedVersion=N

- 认证：受保护；Web 需要 CSRF；仅所有者。
- 成功 204；状态改为 `deleted`，`deleted_at` 设置，策略用途清空并关闭发现。
- 版本不匹配返回 409；非所有者/不存在返回 404。
- 软删除不物理删除来源/审计；读取立即拒绝。超过保留期后由 `app.purge_deleted_memories` 硬删除正文、来源与策略，`memory_events` 审计元数据按独立保留期处理。

## 安全边界

- 所有写操作通过 `app` schema 的 `SECURITY DEFINER` 函数，所有者 `aven_function_owner`；使用事务本地 `app.user_id`。
- `memory_items` 触发器要求 owner 等于当前用户且类型为 user/organization；`memory_sources`/`context_field_policies` 触发器校验来源所有权。
- `memory_items`、`memory_sources`、`context_field_policies`、`memory_events` 均 `FORCE ROW LEVEL SECURITY`；普通池只能读本人，不能直接插入/更新记忆或事件。
- 候选提取不接受客户端 owner；确认/拒绝在函数内再次校验 owner、版本与 pending 状态。
- 检索门 `app.list_memory_for_use` 在数据库层过滤 confirmed、未删除、未过期与用途集合，不能靠客户端筛选绕过。
- `memory_events` 只追加；普通池只有本人 SELECT，没有 INSERT/UPDATE/DELETE。事件 metadata 触发器拒绝未允许键，防止正文进入审计。
- 失效/删除/保留清理函数只授予 `aven_worker`；普通请求角色不能调用硬删除或过期批处理。
- 删除后列表/详情立即拒绝；不承诺清除已导出副本或系统外缓存。
- 当前不向组织或发现者开放原始私人记忆；后续共享必须通过字段投影与 ConsentGrant。

## 验收

- `corepack pnpm memory:verify`：97 项真实 HTTP/数据库检查通过。
- 覆盖：M3-01 创建/详情/列表/分页、手工来源、策略、更新与版本冲突、软删除、跨用户读取/更新/删除拒绝、CSRF、非法受众/发现/重复用途、非法游标、RLS 隔离；M3-02 提取/幂等、候选队列与来源、确认（含修改）/拒绝、状态与版本冲突、默认拒绝、用途检索门、跨用户拒绝、空提取与非法来源；M3-03 事件审计、事件分页、状态转换、到期失效、保留清理、事件保留与跨用户事件隔离。
- 未验证：真实 AI 提取、候选批量复核、语义索引清理、组织记忆、向量、共享授权、Web/Mobile 页面与真实设备。
