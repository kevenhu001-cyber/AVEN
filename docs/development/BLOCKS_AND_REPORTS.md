# 安全与试点准入：个人拉黑（block_lists）、违规举报（reports）与连接邀请限流

日期：2026-11-12。仅开发数据；没有完成生产人工审核后台、移动举报端到端 UI、自动调度或真实 AI。

## 本轮结果

- 交付个人拉黑（Block Lists）管理接口：
  - `POST /api/v1/blocks`：拉黑指定用户，支持可选原因描述；自黑严格被拒（422 Unprocessable Entity）。
  - `DELETE /api/v1/blocks/:userId`：解除拉黑。
  - `GET /api/v1/blocks`：查询当前用户的拉黑列表。
- 交付违规举报（Reports）接口：
  - `POST /api/v1/reports`：提交违规举报，支持针对用户（`user`）或具体连接消息（`message`），支持违规类别（`harassment`、`spam`、`inappropriate_content`、`privacy_violation`、`other`）与详细说明。
  - `GET /api/v1/reports`：查询当前用户所提交的举报记录（状态流转：`pending`、`investigating`、`resolved`、`dismissed`）。
- 双向封锁机制（Bidirectional Enforcement）：
  - 邀请阻止：当 A 拉黑 B 或 B 拉黑 A 时，调用 `app.send_connection_invitation` 均直接抛出 42501 -> 403 Forbidden；解除拉黑后恢复正常邀请建联。
  - 聊天阻止：对于已建立连接，若任一方拉黑对方，双方调用 `app.send_peer_message` 发送消息均被拦截（42501 -> 403 Forbidden）；解除拉黑后恢复正常会话。
- 邀请频控限流（Invitation Rate Limiting）：
  - 在 `app.send_connection_invitation` 中内置基于滑动 24 小时的限流校验（上限 20 次/24h），超过上限拒绝发起（23514 -> 409 Conflict）。
- 严格行级安全（FORCE RLS）与受控权限：
  - `public.block_lists` 与 `public.reports` 全部开启 `FORCE ROW LEVEL SECURITY`。
  - 用户仅能查询自身发起的拉黑名单与自身提交的举报记录，绝不泄露给被拉黑方或被举报方。
  - 普通业务连接角色（`aven_app`）无直接 INSERT/UPDATE/DELETE 权限，全流程由 `aven_function_owner` 的受控安全函数操作。

## 文件、架构与数据库/API

| 路径 | 变化 |
|---|---|
| `docs/architecture/decisions/0015-user-blocks-and-reports.md` | ADR-015：定义拉黑、举报与频控架构决策、RLS 策略与双向阻断规则 |
| `docs/api/BLOCKS_AND_REPORTS.md` | API 契约文档（拉黑/解除/列表、举报提交/列表端点与错误码说明） |
| `packages/database/migrations/0037_user_blocks_and_reports.sql` | `block_lists`、`reports` 表（FORCE RLS）、6 项受控存储函数、更新邀请与聊天逻辑 |
| `packages/database/src/{schema,index,verify}.ts` | Drizzle 表定义、就绪门版本推进至 `0037_user_blocks_and_reports`、60 张租户表（57 public + 3 app）与 37 个迁移检查 |
| `packages/contracts/src/index.ts` / `blocks-and-reports.test.ts` | 请求/响应 Zod 契约、5 项契约单元测试 |
| `packages/api-client/src/moderation.ts` / `moderation.test.ts` | 客户端 `blockUser`、`unblockUser`、`listBlocks`、`submitReport`、`listReports` 方法与 5 项单测 |
| `packages/api-client/src/index.ts` | 挂载 `moderation` 子客户端 |
| `apps/api/src/moderation/moderation.{controller,service,module}.ts` | NestJS 审核模块、端点路由与存储过程调用服务 |
| `apps/api/src/app.module.ts` | 注册 ModerationModule |
| `scripts/moderation-verify.ts` | 端到端全流程验证（27/27 PASS），覆盖拉黑、解黑、双向阻断、举报、隔离与 24h 频控 |
| `package.json` | 增加 `pnpm moderation:verify` 脚本 |

## 实际验证

| 命令 | 结果 |
|---|---|
| `corepack pnpm moderation:verify` | 27/27 检查通过（账号注册、拉黑、自黑拒绝、拉黑隔离、双向邀请拦截、解黑恢复、双向聊天拦截、聊天恢复、用户举报、消息举报、举报隔离、24h 频控 20 次拦截、表直接写入权限限制） |
| `corepack pnpm messages:verify` | 31/31 通过（P2P-04 消息会话与保留清理回归无误） |
| `corepack pnpm notifications:verify:events` | 18/18 通过（活动通知回归无误） |
| `corepack pnpm connections:verify` | 74/74 通过（P2P-01/02 个人连接回归无误） |
| `corepack pnpm m6:verify` | 37/37 通过（M6 日程与活动协调回归无误） |
| `corepack pnpm db:verify` | 184/184 通过（37 个迁移、60 张租户表全部 FORCE RLS） |
| `corepack pnpm test` | 28 个测试文件、227/227 单测通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪探针、0037 就绪门检查通过 |
| `corepack pnpm lint` | ESLint 0 警告 0 报错；depcruise 133 模块 413 依赖 0 违规 |
| `corepack pnpm format:check` | 全部代码风格与格式检查通过 |

## 命令与运行边界

```bash
corepack pnpm moderation:verify
```
