# M0-07 异步可靠性样例

日期：2026-11-11 · 状态：Outbox、BullMQ 消费、回执、重试、死信与故障注入已验证；生产队列运维与业务任务未实现

## 范围

本轮用一个显式标记的 `sample_task` 验证 ADR-005 的异步骨架：业务写入与 Outbox 同事务、派发器租约领取、BullMQ 至少一次投递、`(event_id, consumer)` 回执、数据库副作用与成功回执同事务、稳定外部幂等键、重试/死信与对账。它不是业务功能，也不代表完整队列可靠性或 exactly-once。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0005_outbox_and_sample_task.sql` | `outbox_events`、`job_receipts`、样例任务/结果/外部效果表、RLS 与列级授权 |
| `packages/database/migrations/0006_outbox_available_at_grant.sql` | Worker 回退待处理事件所需的 `available_at` 更新权限 |
| `packages/domain` | 框架无关样例领域服务：事务写入、幂等处理、未知外部结果、死信回执 |
| `apps/worker/src/outbox.ts` | `FOR UPDATE SKIP LOCKED` 租约领取、入队超时、确认、退避、对账 |
| `apps/worker/src/runtime.ts` | BullMQ Queue/Worker、消费回执、失败转 dead、Worker 就绪消费者检查 |
| `apps/worker/src/main.ts` | 管理探针与队列运行时组合、优雅停机 |
| `scripts/async-verify.ts` | 真实 PostgreSQL/Redis 的 29 项异步可靠性验证 |

## 语义

- **至少一次**：`processed` 只表示已入队，不表示副作用完成；重复投递是正常语义。
- **幂等**：`job_receipts` 以 `(event_id, consumer)` 为主键；成功回执与数据库结果同事务提交。重复消费看到 `succeeded` 直接返回既有结果。
- **外部结果未知**：样例在独立提交的 `sample_external_effects` 中写入稳定幂等键；超时/未知后重试先查询该键，不重复执行。
- **租约**：派发器用 `FOR UPDATE SKIP LOCKED` 领取，设置 `locked_by` 与 `lease_expires_at`；过期可重领；确认必须持有未过期租约。
- **崩溃恢复**：领取后崩溃、入队成功后崩溃都由租约过期重领；入队失败把事件退回 `pending` 并延迟重试。
- **对账**：`processed` 但缺失/过期回执的事件在宽限期后补投；宽限期避免与刚入队的任务竞争。
- **死信**：BullMQ 重试 3 次后失败事件标记 `dead`，保留脱敏错误码；不删除原始 Outbox 事件。
- **Redis**：队列连接快速失败，Worker 阻塞连接允许重连；AOF、`noeviction` 与独立卷见 M0-04。

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm async:verify` | 29/29 通过；覆盖成功、重复投递、未知外部结果、死信、事务回滚、租约到期、入队后崩溃、对账补投、Redis 停止/恢复 |
| `corepack pnpm check:readiness` | API 200、Redis 故障 503、Worker 消费者运行时就绪 200 |
| `corepack pnpm db:verify` | 6 个迁移、D1/异步表、RLS 与 36+ 项约束检查通过 |
| `corepack pnpm test` | 48/48 通过 |
| `corepack pnpm test:e2e` | 6/6 通过 |
| `corepack pnpm typecheck` / `build` | 18/18 与 11/11 Turbo tasks 通过 |

故障覆盖：

1. 成功任务：Outbox `processed`、回执 `succeeded`、结果 1 条、外部效果 1 条。
2. 重复投递：结果与外部效果均不重复。
3. 未知外部结果：首次写入外部效果后抛错，重试查询既有结果并成功；回执 attempts ≥ 2。
4. 永久失败：3 次尝试后回执 `dead`，无结果。
5. 业务事务回滚：Outbox 事件不产生。
6. 领取后崩溃：事件保持 `processing` 与租约；租约到期后重领并成功。
7. 入队后崩溃：事件保持 `processing`；恢复后确认且不重复副作用。
8. 对账：`processed` 无回执事件被补投并成功。
9. Redis 停止：入队失败退回 `pending` 且记录 `ENQUEUE_FAILED`；Redis 恢复后重新投递并成功。

## 已知限制

- 样例任务不是业务任务；未实现记忆、匹配、授权失效、通知或日历队列。
- 未实现平台管理员死信查看/重放、审计、告警、指标、队列积压监控或人工对账入口。
- 未验证多 Worker 并发、长时间运行、Redis 集群/Sentinel、网络分区或生产级重试预算。
- 未实现 exactly-once；外部系统必须提供稳定幂等键或人工对账。
- 未接入真实业务写路径；API 尚未产生 Outbox 事件。
- 未实现 `FORCE RLS`、认证写路径或业务域服务；样例表仅用于工程验证。
