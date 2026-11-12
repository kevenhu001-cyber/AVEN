# P2P-04 个人连接会话消息与保留清理

日期：2026-11-12。仅开发数据；没有完成产品聊天 UI、移动即时推送、自动调度或真实 AI。

## 本轮结果

- 基于已建立的独立 `peer_connections`，交付双方点对点消息收发接口：`POST /api/v1/connections/:id/messages`。
- 客户端幂等发送机制（`clientMessageId`）：同幂等键 + 相同内容幂等返回原消息（201/200）；同幂等键 + 不同内容严格返回 409 Conflict。
- 内容有效性校验：非空且首尾去除空白后长度在 1..4000 字符之间。
- 倒序游标分页查询：`GET /api/v1/connections/:id/messages`，默认 limit 50（1..100），基于 `(created_at, id)` 键集倒序游标向前翻页，返回 `messages` 与 `nextCursor`（最后一页返回 null）。
- 单方软删除与双向软删除：`DELETE /api/v1/connections/:connectionId/messages/:messageId`。调用者单方删除后，该消息对调用方隐藏（列表不再返回），但对另一方仍可见。
- 双删受控物理清除（Double-Delete Maintenance Purge）：双方均软删除后，正文由 `app.maintain_peer_messages` 批次清空（置为空字符串），记录 `purged_at`。非双方删除的消息绝不误清。
- 强制行级安全（FORCE RLS）：`peer_messages` 表严格受 `peer_messages_participant_select` 策略保护；仅活跃个人用户且属于对应连接参与者方能读取，且只能读取未对自身软删除的消息。
- 数据库角色与权限边界：普通业务会话（`aven_app`）仅能通过受控函数发送、查询和标记删除，无法调用维护清理；维护函数 `app.maintain_peer_messages` 严格校验 `session_user = 'aven_worker'`。

## 文件、架构与数据库/API

| 路径 | 变化 |
|---|---|
| `docs/architecture/decisions/0014-peer-messaging.md` | ADR-014：架构设计、行级安全、倒序游标分页、单方软删除与保留清理定义 |
| `docs/api/PEER_MESSAGES.md` | API 契约文档（POST/GET/DELETE 端点、错误码、游标格式） |
| `packages/database/migrations/0036_peer_messages.sql` | `peer_messages` 表（FORCE RLS）、分页索引、幂等键约束、四项受控安全函数 |
| `packages/database/src/{schema,index,verify}.ts` | Drizzle 表定义、就绪门版本推进至 `0036_peer_messages`、58 张租户表与 36 个迁移检查 |
| `packages/contracts/src/index.ts` / `peer-messages.test.ts` | 请求/响应/游标 Zod 校验、11 项契约单元测试 |
| `packages/api-client/src/connections.ts` / `connections.test.ts` | 客户端 `sendMessage`、`listMessages`、`deleteMessage` 方法与 15 项单测 |
| `apps/api/src/connection/connection.{controller,service}.ts` | NestJS 控制器端点与服务层，调用受控安全存储函数 |
| `scripts/peer-messages-verify.ts` | 端到端全流程验证（31/31 PASS），覆盖建联、收发、幂等、边界、倒序游标、隔离、双删与 Worker 物理清除 |
| `package.json` | 增加 `pnpm messages:verify` 命令 |

## 实际验证

| 命令 | 结果 |
|---|---|
| `corepack pnpm messages:verify` | 31/31 检查通过（建联、消息收发、幂等重放、409冲突、游标分页、外部隔离、单方删除隔离、双方删除与 Worker 物理清除） |
| `corepack pnpm notifications:verify:events` | 18/18 通过（M6-06A2 活动协调通知回归无误） |
| `corepack pnpm connections:verify` | 74/74 通过（P2P-01/02 个人连接回归无误） |
| `corepack pnpm m6:verify` | 37/37 通过（M6 日程与活动协调回归无误） |
| `corepack pnpm db:verify` | 184/184 通过（36 个迁移、58 张租户表全部 FORCE RLS） |
| `corepack pnpm test` | 26 个测试文件、217/217 单测通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪探针、0036 就绪门检查通过 |
| `corepack pnpm lint` | ESLint 0 警告 0 报错；depcruise 129 模块 395 依赖 0 违规 |
| `corepack pnpm format:check` / `git diff --check` | 全部格式与代码风格检查通过 |

## 命令与运行边界

```bash
corepack pnpm messages:verify
```
