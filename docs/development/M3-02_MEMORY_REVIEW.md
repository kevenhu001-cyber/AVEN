# M3-02 记忆复核

日期：2026-11-11 · 状态：候选提取、确认/修改/拒绝与用途检索门已实现并通过真实 HTTP/数据库验证；真实 Provider、批量复核、生命周期清理与页面未实现

## 范围

本轮实现个人记忆的复核闭环：确定性 Mock 提取只生成 `pending_confirmation` 候选；用户可确认（同时修改标题、正文、类型、敏感度、受众、用途与有效期）或拒绝；主列表只展示已确认记忆；`GET /memories/usable` 与数据库函数 `app.list_memory_for_use` 只返回已确认、未过期且策略明确允许该用途的记忆。未实现 M3-03 生命周期清理、M3-04 真实 Provider、M3-05 流式、组织记忆或共享授权。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0012_memory_review.sql` | 候选唯一索引、来源片段约束、主列表 confirmed 过滤、可编辑状态限制、5 个复核函数与授权 |
| `packages/contracts/src/index.ts` | 候选/提取/确认/拒绝 Schema 与类型 |
| `apps/api/src/memory/memory-extractor.ts` | 确定性 `mock_rules_v1` 提取器，最多 20 条，不编造 |
| `apps/api/src/memory/memory.service.ts` | 提取、候选队列、确认/拒绝、用途检索门、状态校验 |
| `apps/api/src/memory/memory.controller.ts` | `GET /candidates`、`GET /usable`、`POST /extract`、`POST /:id/confirm`、`POST /:id/reject` |
| `apps/api/src/memory/memory-extractor.test.ts` | 提取器规则、去重、上限与截断测试 |
| `scripts/memory-verify.ts` | 在 M3-01 基础上新增 47 项复核检查 |
| `packages/database/src/verify.ts` | 新增候选/确认/拒绝/检索门/跨用户数据库检查 |
| `docs/api/MEMORIES.md` | 1.1 端点、状态机与检索门契约 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm memory:verify` | 74/74 通过；M3-01 27 项 + M3-02 47 项 |
| `corepack pnpm db:verify` | 通过；12 个迁移、11 个记忆函数所有权、92 项数据库检查 |
| `corepack pnpm db:verify:current` | 通过；当前 `aven` 库 92 项检查 |
| `corepack pnpm test` | 71/71 通过（新增提取器与 contracts 测试） |
| `corepack pnpm typecheck` | 18/18 Turbo tasks 通过 |
| `corepack pnpm lint` | 通过；无依赖边界违规 |
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm build` | 11/11 Turbo tasks 通过（由 `memory:verify` 触发） |

关键安全断言：

- 提取只创建 `pending_confirmation`；候选默认 owner-only、不可发现、用途为空，不进入主列表或检索门。
- 同一用户/类型/标题/正文的重复提取返回同一 pending 候选；确认或拒绝后再次提取才创建新候选。
- 确认/拒绝只允许 pending；函数内再次校验 owner、版本与状态，跨用户返回 404/数据库拒绝。
- 确认可修改内容与策略，但必须满足 campus/discoverable 约束；`allowedUses=[]` 允许确认但默认拒绝使用。
- `GET /memories` 只返回 confirmed；`GET /memories/candidates` 只返回 pending；`GET /memories/usable` 只返回 confirmed + 未过期 + 明确用途。
- `rejected` 不能通过 PATCH 恢复，也不能再次确认；`confirmed` 不能再次拒绝。
- `app.list_memory_for_use` 在数据库层过滤状态、有效期与用途，普通池只读本人；跨用户返回空。
- 提取/确认/拒绝均受 CSRF 保护；非法来源类型与空提取返回 422/空数组，不编造候选。

## 已知限制

- 提取器是确定性规则 Mock，只识别带标签的行；不调用真实模型，不证明语义提取能力。
- 未实现候选批量确认/拒绝、候选合并、来源多版本展示或复核历史审计。
- 未实现 M3-03 的过期/失效、索引清理、授权影响与保留策略。
- 未实现组织记忆、匹配画像、向量检索、共享授权或真实共享。
- 未实现 Web/Mobile 记忆复核页面；当前只有 API 与验证脚本。
- 未验证大数据量游标性能、并发确认竞争、备份恢复与生产数据保留。

## 下一步

- M3-03：记忆生命周期（编辑、失效、删除、索引清理与关联授权影响）。
- M3-04/M3-05：Provider/工具契约与 POST run + SSE 流式。
- M3-07：个人页面与记忆复核 UI，接入前登记脱敏评估集与阈值。
- 组织记忆与共享授权在 M4/M5 接入。
