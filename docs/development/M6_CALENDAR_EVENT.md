# M6 日程、忙闲与活动交付记录

日期：2026-11-11 · 状态：忙闲块录入、忙闲投影、忙闲用途授权共享、多方时间求交、活动状态机已实现并通过真实 HTTP/数据库验证；AI 协调、通知投递与外部日历 OAuth 未实现

## 范围

本轮交付 M6-01（个人日程与忙闲）、M6-02 的数据底座（外部日历凭据与游标字段）、M6-03（确定性时间求交）、M6-04（活动状态机）以及 M6-01R（忙闲用途授权共享，用于修复安全核对发现的越权读取）。未实现 M6-05（AI 协调）与 M6-06（通知投递）。

## 安全核对与修复

2026-11-11 核对发现原 `app.query_availability_window` 只校验调用者已登录，未校验被查询主体授权，跨用户忙闲数据存在越权读取风险。修复分两步：

1. 迁移 `0027_availability_privacy` 将查询临时收紧为"仅本人"，fail closed；跨用户求交在授权机制落地前不可用。
2. 迁移 `0029_availability_sharing` 引入显式用途授权：忙闲所有者创建带期限的共享授权（用途 `event_coordination`），被授权方可读取忙闲投影；撤销后立即阻断。

未应用 `0027`/`0029` 的数据库仍受影响，不能用于真实数据。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0025_calendar_and_availability.sql` | `calendar_connections`、`availability_blocks` 表与 FORCE RLS、忙闲读写与投影函数 |
| `packages/database/migrations/0026_events_and_coordination.sql` | `events`、`event_proposals`、`event_participants` 表与 FORCE RLS、`app.can_view_event` |
| `packages/database/migrations/0027_availability_privacy.sql` | 忙闲投影 fail closed（仅本人） |
| `packages/database/migrations/0029_availability_sharing.sql` | 忙闲共享授权的创建、列表、撤销与投影授权判定 |
| `packages/domain/src/time-intersection.ts` | 确定性多方忙碌区间合并与空闲槽位求解纯函数 |
| `packages/contracts/src/index.ts` | 忙闲块、投影、交集、共享授权与活动 Schema |
| `apps/api/src/availability/*`、`event/*` | 忙闲 CRUD、投影与交集、共享授权、活动草稿/提议/响应/取消 |
| `scripts/m6-journey-verify.ts` | 30 项真实 HTTP/数据库检查 |
| `docs/api/AVAILABILITY_EVENTS.md` | 忙闲、共享授权与活动的端点契约 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm m6:verify` | **30/30 通过**；忙闲录入、本人读取、跨用户默认拒绝、共享授权创建/列表/方向性/撤销即时阻断、多方求交、活动草稿/提议/全员接受/取消 |
| `corepack pnpm db:verify` | **184 项数据库检查通过**（含共享授权的自授权、过期期限、超期上限、未知主体、重复授权、反向读取、非授权人撤销、撤销后拒绝） |
| `corepack pnpm m5:verify` | **21/21 通过**（回归） |
| `corepack pnpm isolation:verify` | **21/21 通过**（回归） |
| `corepack pnpm test` | **140/140 通过**（新增共享授权契约测试） |
| `corepack pnpm typecheck` / `lint` / `build` | 全部通过；依赖边界无违规 |

关键安全断言：

- 忙闲投影对每个被查询主体逐个校验：本人或持有未过期、未撤销的共享授权；任一主体不满足则整体 403，不返回部分结果。
- 共享授权单向生效：A 授权 B 不等于 B 可读 A 之外的内容，B 未授权 A 时 A 读不到 B 的忙闲。
- 共享授权必须显式创建、有期限（最长 90 天）、不能自授权、不能重复；只有授权人可以撤销。
- 撤销后立即生效：随后的 `window` 与 `intersection` 请求返回 403，不依赖缓存或任务过期。
- 忙闲投影只返回主体、时间区间与忙闲状态，不含标题、描述、备注等私人字段。
- 活动的确认必须全体参与者接受，事务内原子转入 `confirmed`；新提议会使旧确认失效。
- 非参与者读取活动返回 404。

## 已知限制

- **M6-05 未实现**：没有 AI 约束提取与协调求解，提议时间来自确定性求交结果。
- **M6-06 未实现**：仓库中没有通知表、通知模块、推送或死信处理；关系与活动变化不会产生任何站内或推送通知。
- **M6-02 只完成数据底座**：`calendar_connections` 表与凭据隔离、同步游标字段就绪，但没有第三方 OAuth 连接器、授权跳转与同步任务。
- 忙闲共享授权只区分主体，不区分具体时间窗；共享在期限内覆盖全部忙闲块。
- 没有忙闲与活动的 Web/Mobile 页面（受 M1-07 设计评审门阻塞）。
- 没有重复时区、夏令时与跨天边界的端到端样例（求解器为纯函数并有单元测试，但没有真实活动数据验收）。

## 下一步

- M6-06：站内通知与移动推送（Outbox、幂等、去重、重试、用户偏好、死信人工处理）。
- M6-05：模型提取约束 + 业务求解器计算候选（需要真实 Provider 与评估）。
- M6-02：选定一种日历连接方式并完成凭据加密、撤销、同步游标与失败恢复。
