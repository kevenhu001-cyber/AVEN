# 日程、忙闲与活动 API

适用里程碑：M6-01、M6-02、M6-03、M6-04、M6-01R。契约来源：`packages/contracts/src/index.ts` 中的 `Availability*`、`Time*`、`Event*` Schema。

端点位于 `/api/v1/availability` 与 `/api/v1/events`，需要会话；写操作需要 CSRF。

## 1. 忙闲块

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/availability/blocks` | 新增或更新本人的忙闲块 |
| `DELETE` | `/api/v1/availability/blocks/:id` | 删除本人的忙闲块 |
| `GET` | `/api/v1/availability/me` | 本人忙闲块列表，可带 `startAt`/`endAt` |

请求（`UpsertAvailabilityBlockRequestSchema`）：

```json
{
  "startAt": "2026-11-12T02:00:00.000Z",
  "endAt": "2026-11-12T04:00:00.000Z",
  "timezone": "Asia/Shanghai",
  "status": "busy",
  "source": "manual",
  "blockId": null
}
```

- 时间统一以 UTC 存储，`timezone` 保留原始时区；`status` 取 `busy` / `tentative` / `free`。
- 只有本人可以写入、修改或删除自己的忙闲块。

## 2. 忙闲投影与共享授权

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/availability/window` | 查询时间窗内的忙闲投影 |
| `POST` | `/api/v1/availability/intersection` | 计算多方共同空闲时段 |
| `POST` | `/api/v1/availability/shares` | 授权对方读取自己的忙闲投影 |
| `GET` | `/api/v1/availability/shares` | 列出我给出/收到的共享授权 |
| `DELETE` | `/api/v1/availability/shares/:id` | 撤销我给出的共享授权 |

### 2.1 默认拒绝

`POST /window` 与 `POST /intersection` 中，**每个** `principalIds` 都必须满足下列之一，否则整体返回 403（不返回部分结果）：

- 是调用者本人；
- 调用者持有该主体授予的、状态 `active`、未过期的忙闲共享授权。

跨用户读取在未授权时一律 403，错误体使用统一结构（`FORBIDDEN`），不泄露对方是否有忙闲数据。

### 2.2 共享授权模型

授权由忙闲所有者显式创建（`M6-01R`）：

```json
{ "granteePrincipalId": "…", "expiresAt": "2026-11-20T00:00:00.000Z" }
```

- 授权落库为用途 `event_coordination` 的 `consent_grants` 记录，绑定授权人与被授权主体、期限与版本。
- 期限必须晚于当前时间，且不超过 90 天；不能授权给自己；同一对主体不能存在重复的有效授权（409）。
- 授权是**单向**的：A 授权 B 后，B 可读 A 的忙闲；B 未授权 A 时 A 仍不能读 B 的忙闲。
- 被授权主体可以是个人或组织主体；组织主体被授权时，其当前有效成员可读取。
- 撤销后**立即生效**：下一次 `window` / `intersection` 请求返回 403，不需要等待缓存或任务过期。
- 忙闲投影始终不含标题、描述、备注等私人字段，只返回 `principalId`、时间区间与忙闲状态。

### 2.3 交集计算

`POST /api/v1/availability/intersection` 请求：

```json
{
  "principalIds": ["…", "…"],
  "windowStart": "2026-11-12T00:00:00.000Z",
  "windowEnd": "2026-11-12T09:00:00.000Z",
  "durationMinutes": 60,
  "workingHoursOnly": false
}
```

算法为确定性纯函数（`packages/domain/src/time-intersection.ts`）：合并各主体的忙碌/暂定区间，按工作时段与最短时长切出空闲槽位。无交集时返回空数组，不放宽条件。

## 3. 活动（Event）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/events` | 创建活动草稿 |
| `GET` | `/api/v1/events/me` | 我参与的活动，可按 `status` 过滤 |
| `GET` | `/api/v1/events/:id` | 活动详情（参与者或组织成员） |
| `POST` | `/api/v1/events/:id/proposals` | 提议时间 |
| `POST` | `/api/v1/events/:id/responses` | 参与者响应 |
| `POST` | `/api/v1/events/:id/cancel` | 取消活动 |

### 3.1 状态机

`draft → proposed → pending_confirmation → confirmed`，另有 `cancelled` 与 `ended` 终态。

- 创建草稿时给出 `attendeePrincipalIds`，参与人响应单独记录在 `event_participants`。
- 提议时间生成 `event_proposals`（状态 `proposed`）；旧提议被新提议取代（`superseded`），已基于旧提议作出的确认随之失效，需要重新确认。
- **全部参与者接受后**在同一事务内转入 `confirmed`；任一参与者拒绝或取消则不成立。
- 取消后活动进入 `cancelled`，不会因迟到响应回到 `confirmed`。

### 3.2 提议与响应

```json
{ "startAt": "…", "endAt": "…", "timezone": "Asia/Shanghai", "expectedVersion": 1 }
```

```json
{ "response": "accepted", "expectedVersion": 2 }
```

`response` 取 `pending` / `accepted` / `declined` / `tentative`；版本冲突返回 409。

### 3.3 访问控制

`app.can_view_event` 判定参与者与组织成员可见性；非参与者读取返回 404。

## 4. 外部日历

- `calendar_connections` 表已建立，凭据加密隔离与同步游标字段就绪（迁移 `0025`）。
- **尚未实现真实 OAuth 第三方日历接入**：没有连接器、没有授权跳转、没有同步任务。当前所有忙闲数据都来自手工录入。

## 5. 验证记录

- `corepack pnpm m6:verify`：31 项真实 HTTP/数据库检查通过，覆盖忙闲录入、本人读取、跨用户默认拒绝、共享授权创建/列表/方向性/撤销即时阻断、多人求交、活动草稿/提议/全员接受/取消。
- `corepack pnpm db:verify`：数据库级共享授权检查（自授权、过期期限、超期上限、未知主体、重复授权、反向读取、非授权人撤销、撤销后拒绝）通过。

## 6. 未实现

- M6-05：AI 活动约束提取与协调求解。
- M6-06：站内通知与移动推送投递（仓库中没有任何通知表与模块）。
- 外部日历 OAuth 连接器与同步任务。
- 忙闲共享的界面与时间窗授权细化（当前授权覆盖到期限，不区分具体时间窗）。
