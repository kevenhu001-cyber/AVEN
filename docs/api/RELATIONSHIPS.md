# 关系空间 API

适用里程碑：M5-05、M5-06、M5-07。契约来源：`packages/contracts/src/index.ts` 中的 `Relationship*` Schema。

端点位于 `/api/v1`，需要会话；写操作需要 CSRF。关系空间是双方确认后的唯一共享范围。

## 1. 建立关系

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/relationships` | body `{ "referralId": "…" }`，在事务中建立关系 |
| `GET` | `/api/v1/relationships/me` | 本人参与的关系 |
| `GET` | `/api/v1/organizations/:id/relationships` | 组织的关系列表（仅本组织有权成员） |
| `GET` | `/api/v1/relationships/:id` | 关系详情 |
| `GET` | `/api/v1/relationships/:id/context` | 共享上下文（受授权快照约束） |
| `POST` | `/api/v1/relationships/:id/close` | 关闭关系，body `{ "reason": "…" }` |

### 1.1 建立条件

`app.establish_relationship` 在同一事务内重新校验：

1. 引荐存在且状态为 `accepted`；
2. 双方决定均为接受；
3. 发起人仍是引荐发起人，组织方当前调用者是该组织有权成员；
4. 机会仍然可用（未关闭、未过期）；
5. 授权仍有效。

不满足任一条件即整体回滚，不会留下半成品关系。

### 1.2 唯一性

同一 `(applicant_user_id, opportunity_id)` 只允许存在一个 `active` 关系，由唯一约束保证；并发接受不会产生两个关系空间。

### 1.3 状态

`active → paused → completed → closed`。关闭后共享上下文立即不可读（返回空对象），关系与成员记录保留用于审计。

## 2. 共享上下文

`GET /api/v1/relationships/:id/context` 返回按字段聚合的共享内容：

- 只读取 `shared_context_items` 中状态为 `active`、且父授权 `consent_grants` 仍为 `active`、未过期、未撤销的条目。
- 关系用途（`relationship_context`）与引荐用途（`referral`）分开，不会因为引荐授权而扩大关系共享范围。
- **撤销即时生效**：撤销授权后同一接口立即返回空上下文（`m5:verify` 覆盖该路径）。
- 未确认时共享上下文为空对象，不返回任何私人字段。

## 3. 权限与失败

| 场景 | 结果 |
|---|---|
| 非参与者读取关系 | 404 |
| 非组织成员读取组织关系列表 | 403 |
| 未双方接受即建立关系 | 409 |
| 已存在活动关系时再次建立 | 409 |
| 版本冲突的关闭请求 | 409 |

## 4. 验证记录

- `corepack pnpm m5:verify`：双方接受后原子建联、唯一性、成员权限、共享上下文受控读取、授权撤销后即时阻断、参与者关闭关系等真实 HTTP/数据库检查通过。
- `corepack pnpm isolation:verify`：跨账号、跨组织与连接池上下文检查通过。

## 5. 未实现

- 关系空间内的会话与消息：`conversations` / `messages` 表已存在，但**没有 API 与界面**。
- 关系目标的结构化管理、关系文件与链接。
- 关系用途下的新增字段授权（当前快照来自引荐阶段授权）。
- Web 与移动端关系空间页面（受 M1-07 设计评审门阻塞）。
