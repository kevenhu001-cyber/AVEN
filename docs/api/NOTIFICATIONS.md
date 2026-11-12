# 站内通知 API（M6-06A1 + M6-06A2）

范围：个人连接（邀请、接受、拒绝、撤回、授权撤销）与活动协调（提议时间、全员确认、取消）的站内通知；移动推送、实时推送和产品 UI 仍未实现。

## 数据和权限

通知只含 ID、kind、target（`{ type: 'connection_invitation', id }` 或 `{ type: 'event', id }`）、createdAt、readAt，不保存姓名、邮箱、私人正文、活动标题、地点或共享快照。列表与已读操作仅实际接收用户的个人会话可用；服务端根据当前业务状态和双方 active 状态过滤，过期/撤回/撤销后的待办或无权限活动不继续作为待办返回。打开详情须调用原连接或活动 API，通知不赋予新的访问权。

- **个人连接通知**：邀请 sent 通知给接收方；accepted/declined 通知给发送方；withdrawn/revoked 通知给接收方。
- **活动协调通知**：propose 通知给其他被邀请参与者；全员接受 confirmed 通知给所有参与者；cancel 通知给其他参与者。
- **事务一致性**：新事件与业务事务同提交（同事务写入 `public.event_coordination_events` / `public.connection_events` 与 Outbox）；失败回滚不通知。同一来源事件最多一条通知，允许至少一次投递。

## 端点

路径 `/api/v1/notifications`，真实会话、Web 写操作 CSRF；不接受 actor/recipient 输入。

| 方法 | 路径 | 输入与输出 |
|---|---|---|
| GET | `/` | `limit?:1..100`（默认 20），配对 `cursorCreatedAt`/`cursorId` → `{data,nextCursor,unreadCount}`，按创建时间/ID 倒序，当前可见且 90 天内 |
| POST | `/:id/read` | 无 body → 本人当前可见通知，重复已读不改变首次 readAt；外人/失效统一 404 |
| GET | `/preferences` | `{connectionInvitations,connectionUpdates,eventInvitations,eventUpdates,version}`，未配置默认全部 true，version 0 |
| POST | `/preferences` | `{connectionInvitations?,connectionUpdates?,eventInvitations?,eventUpdates?,expectedVersion}` → 更新后偏好；版本不符 409 |
| GET | `/deliveries/dead` | 仅当前平台管理员，最近 100 个死信必要元数据，不含接收人/正文 |
| POST | `/deliveries/:id/retry` | 仅当前平台管理员，`{expectedGeneration}`；仅 dead 可重排，代数递增并审计；并发/旧代数 409 |

关闭偏好只抑制消费时尚未送达的对应分类；既有通知不因开关消失。重新开启不补发已抑制事件。队列延迟时复核当前状态/偏好，无法通知也不回滚原业务。

## 可靠性与运维

使用 notification_deliveries 作为事务回执，业务唯一键为来源事件 ID；通知插入与 delivered/suppressed 回执同事务。队列最多 5 次指数退避，失败只记录固定错误码；dead 不自动重放。平台管理员重试绑定 generation，旧任务/失败回调不能污染新代数；重试仍检查当前业务和偏好。

processed 仅表示 Outbox 入队，Worker 对账 pending 回执，处理 Redis 丢任务或入队后未确认；重复任务仍由数据库去重。显式维护清除 90 天前站内通知，保留去重元数据，不复活旧通知。生产调度、积压告警和完整 Outbox/回执保留另行交付。

统一错误：401 无会话、403 非平台管理员、404 不存在/非本人/不可见、409 版本/重排冲突、422 非法输入；无 SQL、正文或凭据回显。
