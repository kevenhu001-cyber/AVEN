# M6 日程、忙闲与活动交付记录

2026-11-12 后续更新：个人连接站内通知后端已交付，见 [通知交付记录](NOTIFICATIONS.md)。本文的日程交付证据保持原范围；活动通知、移动推送与通知 UI 仍未实现。

日期：2026-11-11 · 状态：忙闲块录入、忙闲投影、忙闲用途授权共享、多方时间求交、活动状态机已实现并通过真实 HTTP/数据库验证；AI 协调、通知投递与外部日历 OAuth 未实现

## 范围

本轮交付 M6-01（个人日程与忙闲）、M6-02 的数据底座（外部日历凭据与游标字段）、M6-03（确定性时间求交）、M6-04（活动状态机）以及 M6-01R（忙闲用途授权共享，用于修复安全核对发现的越权读取）。后续已补充交付 M6-06A1/A2（站内通知后端，见 [NOTIFICATIONS.md](NOTIFICATIONS.md)）与 **M6-05（PARTIAL：Mock 默认 AI 约束提取 + 按参与者当地 IANA 时区求解接口 `POST /api/v1/events/coordinate`）**；真实外部 AI Provider、M6-06 移动推送/UI 与 M6-02 OAuth 连接器仍未实现。

### M6-05 本轮新增实现

- `@aven/contracts`：新增 `CoordinateEventRequestSchema`、`CoordinateEventResponseSchema`、`ExtractedEventConstraintsSchema`、`EventCoordinationOverridesSchema` 等契约 Schema 与类型，并补充 3 项契约单测。
- `@aven/ai-core`：新增 `extractEventConstraints` 与确定性中文/英文相对时间提示解析，统一经由 `AIProvider.generateObject`（`purpose: 'intent_extraction'`，默认 `MockProvider`）输出，并补充 4 项单测。
- `@aven/domain`：新增 `coordinateEventSchedule`、`zonedWallClockToUtc` 与按参与者当地 IANA 时区工作时段构造非工作阻断区间的确定性求解器，处理夏令时回拨与跨日午夜区间，按 `preferredTimeOfDay` 排序候选，返回 `needs_clarification` / `no_common_slots` / `candidates_ready`；补充 5 项单测。
- `@aven/api-client` & `apps/api`：新增 `POST /api/v1/events/coordinate`（Nest `EventCoordinationService` + `EventController`）与 `client.events.coordinate`，先在所有非本人参与者上校验 `event_coordination` 忙闲共享授权再执行提取与求解，显式返回 `externalCalendarsModified: false`；补充 2 项客户端单测与 4 项服务端单测，并在 `scripts/m6-journey-verify.ts` 中追加 4 项端到端校验用例。

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

本轮求交可靠性补验见 [M6_RELIABILITY.md](M6_RELIABILITY.md)：单元测试 162/162、M6 真实 HTTP/数据库检查 37/37（新增 7 项），格式、lint、类型、构建与诊断页 E2E 通过。以下保留前轮执行记录。

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

- **M6-05 当前为 Mock 默认 + 确定性求解（`PARTIAL`）**：`MockProvider` 下使用确定性规则解析自然语言与缺省澄清；真实外部 AI Provider 尚未接入验证，且当前 Windows 工作机无 Docker/PostgreSQL/Redis 环境，`scripts/m6-journey-verify.ts` 中新增的 M6-05 HTTP/DB 检查尚未在真实库上实跑。
- **M6-06 移动推送与通知 UI 未实现**：个人连接与活动协调站内通知后端（Outbox/BullMQ/偏好过滤）已另见 [NOTIFICATIONS.md](NOTIFICATIONS.md)，但移动推送与通知 UI 仍待开发。
- **M6-02 只完成数据底座**：`calendar_connections` 表与凭据隔离、同步游标字段就绪，但没有第三方 OAuth 连接器、授权跳转与同步任务。
- 忙闲共享授权只区分主体，不区分具体时间窗；共享在期限内覆盖全部忙闲块。
- 没有忙闲与活动的 Web/Mobile 页面（受 M1-07 设计评审门阻塞）。
- `apps/api` 与 `packages/domain` 的 M6-05 覆盖单元测试（含夏令时回拨与跨时区工作时段）与离线校验已通过，但端到端真实数据库/Redis 回归仍待实时依赖环境补跑。

## 下一步

- 在具备 Docker/PostgreSQL/Redis 的环境中实跑 `corepack pnpm m6:verify`，验证含 M6-05 新增 4 项在内的真实 HTTP/DB 检查，并接入脱敏评测集验证真实 AI Provider 的约束提取准确率。
- M6-06：真实移动推送投递、产品通知 UI 与生产调度告警。
- M6-02：选定一种日历连接方式并完成凭据加密、撤销、同步游标与失败恢复。
