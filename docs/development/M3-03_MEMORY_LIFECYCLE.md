# M3-03 记忆生命周期

日期：2026-11-11 · 状态：生命周期审计、到期失效、软删除保留与审计保留清理已实现并通过真实 HTTP/数据库验证；语义索引清理、组织记忆、共享授权与页面未实现

## 范围

本轮实现个人记忆的生命周期：`memory_events` 只追加审计；确认、拒绝、更新、删除、到期与保留清理记录状态转换与版本；到期记忆由维护函数转为 `expired` 并清空用途；软删除超过保留期的正文由维护函数硬删除；审计事件按独立保留期清理。未实现 M3-04 真实 Provider、M3-05 流式、M3-06 行动确认、组织记忆、语义索引或共享授权。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0013_memory_lifecycle.sql` | `memory_events` 表/枚举/索引、metadata 触发器、FORCE RLS、审计触发器、事件列表/到期/正文清理/事件清理函数与授权 |
| `packages/database/migrations/0014_memory_clock.sql` | 到期与用途检索门改用 `clock_timestamp()`，避免长事务使用事务开始时间 |
| `packages/contracts/src/index.ts` | `MemoryEvent`、事件类型/actor 类型与列表 Schema |
| `apps/api/src/memory/memory.service.ts` | 事件游标分页与映射 |
| `apps/api/src/memory/memory.controller.ts` | `GET /memories/:id/events` |
| `scripts/memory-maintenance.ts` | `memory:maintain` 维护命令：到期、正文清理、事件清理 |
| `scripts/memory-verify.ts` | 新增 23 项事件/到期/保留检查 |
| `packages/database/src/verify.ts` | 新增 18 项事件/触发器/到期/清理/元数据检查 |
| `docs/api/MEMORIES.md` | 1.2 事件、生命周期与保留契约 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm memory:verify` | 97/97 通过；M3-01 27 项 + M3-02 47 项 + M3-03 23 项 |
| `corepack pnpm db:verify` | 通过；14 个迁移、16 个记忆函数所有权、22 张表 FORCE RLS、110 项数据库检查 |
| `corepack pnpm memory:maintain` | 通过；输出 `{"expired":0,"purged":0,"purgedEvents":0,"deletionRetentionDays":30,"eventRetentionDays":365}` |
| `corepack pnpm test` | 72/72 通过（新增事件 contracts 测试） |
| `corepack pnpm typecheck` | 18/18 Turbo tasks 通过 |
| `corepack pnpm lint` | 通过；无依赖边界违规 |
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm build` | 11/11 Turbo tasks 通过（由 `memory:verify` 触发） |
| `corepack pnpm check:readiness` | API/Worker 就绪检查通过 |

关键安全断言：

- `memory_events` 只追加；普通池只有本人 SELECT，没有 INSERT/UPDATE/DELETE；函数所有者只有 SELECT/INSERT/DELETE，没有 UPDATE。
- 审计触发器只写事件类型、状态转换、版本、actor 类型与受限 metadata；metadata 触发器拒绝 `content`/`title`/`excerpt` 等未允许键。
- 到期由 `app.expire_due_memories` 执行：只处理 confirmed 且 `valid_until <= clock_timestamp()` 的行，清空用途并关闭发现；维护函数只授予 `aven_worker`。
- 正文清理由 `app.purge_deleted_memories` 执行：只处理 `deleted` 且超过保留期的行，删除来源与策略；审计事件保留并记录 `purged`。
- 审计清理由 `app.purge_memory_events` 独立执行；正文保留期与审计保留期分离。
- 事件列表按 owner 过滤；跨用户返回空；软删除/已清理正文的记忆仍可读取保留期内的事件。
- 到期/清理后的记忆立即从主列表与用途检索门消失；读取不依赖异步任务是否已运行。

## 已知限制

- 未实现定时调度；当前通过 `corepack pnpm memory:maintain` 手动/外部调度运行，生产 cron/队列调度未接入。
- 未实现 `memory_embeddings`/pgvector；语义索引清理在启用语义模块后接入，当前删除/失效已清空用途并拒绝读取。
- 未实现 ConsentGrant/共享授权失效传播；M5 接入时需在同一失效路径标记授权项 stale。
- 未实现组织记忆、组织成员读取、匹配画像或共享。
- 未实现 Web/Mobile 记忆生命周期页面；当前只有 API 与验证脚本。
- 未验证大数据量清理批次、并发维护任务、备份恢复与生产数据保留。

## 下一步

- M3-04：Provider 与工具契约（Mock/真实 Provider、Zod 参数、权限、超时、重试、审计）。
- M3-05：POST run + SSE 流式与真实代理/原生流验证。
- M3-06：行动预览与确认。
- M3-07：个人页面与记忆复核 UI，接入前登记脱敏评估集与阈值。
- 语义索引清理与 ConsentGrant 失效传播分别在语义模块与 M5 接入。
