# M3-06 行动预览与确认

日期：2026-11-11 · 状态：行动草稿、预览、一次性确认、幂等执行与取消已实现并通过真实 HTTP/数据库验证；真实高影响行动、Agent 自动提议、失败重试与页面未实现

## 范围

本轮建立 `actions` 行动确认框架：用户或运行时创建 `memory.create` 草稿；草稿绑定 `draft_version`、`expires_at`、run 与一次性确认 token；确认时重新校验所有者、token 哈希、版本、有效期、状态与幂等键，在同一事务内创建记忆并写入 `succeeded`/`result`；重复确认返回同一结果，不重复创建记忆；取消与过期拒绝可验证。未实现 M3-07 页面/评估、M4/M5 的发布/引荐/共享行动、Agent 自动提议行动或失败重试。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0016_actions.sql` | `action_status` 枚举、`actions` 表、FORCE RLS、4 个行动函数与授权 |
| `packages/database/migrations/0017_actions_fix.sql` | 修正函数内 `RETURNS TABLE` 输出列与表列的歧义 |
| `packages/contracts/src/index.ts` | Action 创建/确认/取消 Schema、状态枚举与错误码 |
| `apps/api/src/action/*` | 草稿创建、预览、确认、取消；token 生成与哈希；幂等键 |
| `scripts/action-verify.ts` | 33 项真实 HTTP/数据库检查 |
| `docs/api/ACTIONS.md` | 1.0 端点、token、幂等、错误与安全边界 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm action:verify` | **33/33 通过**；草稿/预览/token/版本/token 错误/确认/重复确认/取消/过期/run 绑定/CSRF/日志 |
| `corepack pnpm db:verify` | **128 项数据库检查通过**；17 个迁移、30 张表 FORCE RLS、4 个行动函数 |
| `corepack pnpm test` | **105/105 通过**（新增 Action contracts 测试） |
| `corepack pnpm typecheck` | **20/20 Turbo tasks 通过** |
| `corepack pnpm lint` | 通过；无依赖边界违规 |
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm build` | **12/12 Turbo tasks 通过** |
| `corepack pnpm agent:verify` | 45/45 回归通过 |
| `corepack pnpm async:verify` | 29/29 回归通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查通过 |

关键安全断言：

- 草稿创建只写 `pending_confirmation`，不执行高影响副作用；确认才执行。
- 确认 token 由服务端生成，明文只在创建响应返回一次；数据库只存 SHA-256。
- 确认重新校验所有者、token 哈希、`draft_version`、有效期、状态与幂等键；不信任客户端 principal/organization。
- 确认执行在单一事务内创建记忆、更新行动与幂等结果；重复确认（相同或不同幂等键）返回同一 `memoryId`，不重复写入。
- 取消只作用于 `pending_confirmation`；已执行行动不能取消；取消不产生业务副作用。
- 过期草稿确认时置为 `expired` 并返回 409；已取消/失败不可确认。
- `actions` 表 FORCE RLS；普通池只能读本人；写操作只通过受控函数。
- 草稿 payload 不进入日志、Outbox 或分析事件；日志只记录 route/status/request_id。

## 已知限制

- 当前只实现 `memory.create` 行动类型；发布机会、发送引荐、共享资料、关闭关系等高影响行动在 M4/M5 接入。
- Agent 运行时尚未自动生成 `action.proposed` 草稿；M3-06 通过 API 创建草稿。
- 没有草稿编辑接口；`draft_version` 固定为 1，旧确认失效路径通过版本校验预留。
- 失败执行的自动重试/对账未实现；当前事务失败会回滚到 pending，客户端可重新确认。
- 没有行动过期扫描任务；过期状态在确认时写入，`GET` 仍可能显示 pending 直到确认或维护任务。
- 未实现 Web/Mobile 行动预览/确认页面或真实设备验证。

## 下一步

- M3-07：个人页面、记忆复核 UI、脱敏评估集与预算/阈值。
- M4/M5：把机会发布、引荐发送、共享资料等高影响行动接入同一确认框架。
- 后续补 Agent 自动提议行动、失败重试/对账、过期扫描与页面。
