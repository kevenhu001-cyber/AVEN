# 个人连接 API

日期：2026-11-12 · 本轮契约：个人到个人连接底座，不代表 UI、AI 推荐或通知已实现。

## 边界与数据

- 路径 `/api/v1/connections`，均需真实会话，Web 写入需要 CSRF。actor 仅从服务端会话派生，不接受 sender/owner 主体字段。
- 当前接收方由已知用户 UUID 指定；不提供任意用户搜索、姓名或私人资料发现接口。自邀请、组织/停用/不存在主体被拒绝。
- 本轮只共享用户明确选择的已确认记忆 `content`，每次 1–10 项，必须允许 `sharing`、未删除且未过期。标题、邮箱、显示名、原始对话及未选字段不附带共享。
- 新用途 `connection_invitation`，不升级为 `relationship_context`。个人连接独立于机会引荐，建立后不复制邀请快照到关系上下文。

## 端点

| 方法 | 路径 | 请求与结果 |
|---|---|---|
| POST | `/previews` | `{recipientUserId,memoryItemIds,expiresInDays?:1..7}` → 201 `{id,recipientUserId,purpose,snapshot,grantExpiresAt,expiresAt}` |
| POST | `/invitations` | `{previewId}` + 必填 UUID `Idempotency-Key` → 201 邀请元数据 |
| GET | `/invitations` | 本人发出与收到的邀请，最多 100 条，按创建时间与 ID 倒序，不附正文 |
| GET | `/invitations/:id` | 仅双方，邀请元数据，实时反映授权与到期状态 |
| GET | `/invitations/:id/snapshot` | 仅双方，实时检查后返回 `{invitationId,items:[{sourceId,field,value}]}`；失效返回空数组 |
| GET | `/invitations/:id/widget` | 仅双方，返回 `{kind:'connection_invitation',role,invitation,snapshot}`；先锁定并复核快照，再在同事务读取元数据，供会话小组件按需读取 |
| POST | `/invitations/:id/decision` | 接收方 `{decision:'accepted'|'declined',expectedVersion}`；接受时同事务建联 |
| POST | `/invitations/:id/withdraw` | 发起方 `{expectedVersion}`；仅 pending 可撤回，同步撤销邀请授权 |
| POST | `/invitations/:id/revoke` | 发起方撤销本次邀请授权，幂等；已建立的连接元数据不删除 |
| GET | `/` | 本人已建立的个人连接元数据，最多 100 条；不返回邀请快照 |

`snapshot` 为选中内容实际值，preview 默认 10 分钟失效。`grantExpiresAt` 为预览时起最多 7 天，并收紧到最早的源记忆到期瞬间，发送不延长。发送时逐项锁定与重验源值、版本、策略、接收方及期限，变化后 409，必须重新预览。预览不会让接收方看到任何内容。

邀请元数据仅包含 ID、双方 UUID、状态、版本、授权 ID/状态、创建与到期时间、双方决定时间、连接 ID，不自动展示姓名。发送即发起方同意，接收方另行决定。`pending → accepted | declined | withdrawn`，到期读取投影为 expired；到期后不能决定。拒绝/撤回使本次邀请授权撤销。

## 并发、重试与读取

- 同一无序用户对最多一个待处理/已接受邀请；反向同时邀请不自动接受。双方接受不是“互相发一条”推断。
- 同一无序用户对最多一个连接。接收方重复或并发接受返回同一连接，不重复写事件。
- 相同 sender/key/preview 重试返回当前元数据；同 key 不同 preview 为 409。已消费 preview 换新 key 为 409。
- 幂等重放不包含快照正文；读取端仍核对主库的 grant/item、来源/用途策略、双方 active 与到期状态。
- 来源删除、失效或收紧 sharing 用途，同事务将依赖的个人邀请快照标为 stale，重新开放用途不复活旧快照。普通编辑不改已授权快照值，但发送前版本变化必须重新预览。
- 接受时原选条目必须全部仍有效；部分来源失效时读取仅返回剩余有效项，但不能据此接受旧预览（0032 修正）。
- 仅授权人可撤销。撤销提交后新的快照读取为空；不能收回在途字节、已送达内容或系统外副本。
- 角色为受限 `aven_app`；新增表 FORCE RLS，正文表不开放直接 SELECT，写入仅受控函数。审计只记 actor、对象、事件与版本，不记私人正文。

## 失败与限制

### 正文保留与维护（P2P-03）

预览过期满 24 小时后清空 manifest 正文，保留元数据供发送幂等重放。个人邀请授权项在首次失效满 30 天后清为空值并记录清除时间；权限收紧和清除不复活旧授权。维护不改变邀请状态/版本或已建立连接，不处理其他用途快照。只允许 `aven_worker` 调用 `app.maintain_personal_connections(batchSize)`，批次 1–1000；没有面向用户或管理员 HTTP 的全库清理入口。规则见 [ADR-012](../architecture/decisions/0012-connection-retention.md)。

### 小组件读取与共享客户端（P2P-02）

`role` 由服务端会话推导，为 `sender` 或 `recipient`，不接受客户端 actor。`snapshot` 与独立快照端点同形；撤销、拒绝、来源失效或过期后不返回失效正文。该接口不提供操作授权凭证；每次发送、决定、撤回、撤销仍由原写端点重新校验权限与版本。部分来源失效后，小组件可能只显示剩余内容，但不能据此接受原邀请。界面应处理 409 并重新读取，不得自动重新确认。

`@aven/api-client` 提供 `connections` 方法组，读写均验证输入/响应，不缓存正文或保存会话。每次调用显式提供 `auth: {kind:'web',csrfToken?}` 或 `{kind:'mobile',bearerToken}`；Web 写入必须带 CSRF，移动端通过 Bearer 调用。发送必须由调用方传入 UUID 幂等键；网络失败、超时或取消不代表写入未发生，客户端不自动重试，显式重试须复用原预览与键。身份切换/退出时由调用方取消在途读取并清除已显示内容。

小组件读取协议不等于聊天组件、Agent 工具绑定、实时投递或插件运行时。这里未实现产品 UI。

无会话 401；无权访问邀请或不存在统一 404；非法字段/UUID/请求上限 422；版本、过期、预览来源变化、重复连接、同 key 异参为 409；拒绝读取不回显 SQL 或私人来源。

这轮不实现个人发现、拉黑/举报、真实推荐、消息、推送、真实模型或插件运行时；使用三个开发账号验证隔离，不接纳真实用户试点。
