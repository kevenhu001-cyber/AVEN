# M4 组织资源与机会交付记录

日期：2026-11-11 · 状态：组织资料更新、机会生命周期、组织控制台页面、组织 Agent 与组织边界测试已实现并通过真实 HTTP/数据库验证；正式双端设计评审、组织认证审核流与真实 AI 草稿未完成

## 范围

本轮交付 M4-01 至 M4-05：组织公开资料更新与只读公开视图；机会从草稿到发布、暂停、关闭、到期的完整生命周期；Web 端组织控制台（Overview、机会管理、成员列表、收件箱占位）；组织范围内的 Agent 检索与机会草稿行动提议；以及组织边界与越权测试。未实现真实模型接入、M6 日程活动与通知投递。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0018_opportunities.sql` | `opportunities` 表、FORCE RLS、`update_organization`、`get_public_organization` 与 11 个机会生命周期存储函数 |
| `packages/database/migrations/0019_organization_agent_actions.sql` | 组织范围检索与机会草稿行动函数 |
| `packages/database/migrations/0020_organization_worker_helpers.sql`、`0021_fix_org_worker_context.sql` | Worker 隔离加载与上下文修正 |
| `packages/contracts/src/index.ts` | 机会创建/更新/详情 Schema、可见范围与状态枚举 |
| `apps/api/src/opportunity/*` | 机会创建、发布、暂停、关闭、查询与公开视图 |
| `apps/api/src/agent/*` | `opportunity.search`、`organization_context.search`、`opportunity_draft.create` 工具与行动确认 |
| `apps/web/src/app/organizations/[id]/*` | 组织控制台页面与 loading/empty/error/success/denied 状态矩阵 |
| `scripts/opportunity-verify.ts`、`scripts/opportunity-maintenance.ts` | 34 项真实端到端检查与到期维护任务 |
| `scripts/org-boundary-verify.ts` | 25 项组织边界与越权检查 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm opportunity:verify` | **34/34 通过**；草稿/发布/暂停/关闭终态、乐观锁并发、同校与全网可见性隔离、过期动态状态与定时维护 |
| `corepack pnpm org:verify` | **25/25 通过**；非成员拦截、旧草稿确认阻断、私有资料防泄漏、成员移除后拒绝、FORCE RLS |
| `corepack pnpm isolation:verify` | **21/21 通过**；跨账号、跨组织与连接池上下文 |
| `corepack pnpm m5:verify` | **21/21 通过**（回归） |
| `corepack pnpm db:verify` | **184 项数据库检查通过**（含机会表约束、函数边界与 RLS） |
| `corepack pnpm test` | **140/140 通过** |
| `corepack pnpm typecheck` / `lint` / `build` | 全部通过；依赖边界 119 模块无违规 |

关键安全断言：

- 机会的创建、发布、暂停、关闭全部走受控存储函数，服务端重新校验组织成员身份与所有权，不信任客户端传入的主体或组织 ID。
- 乐观锁版本冲突返回 409，不静默覆盖。
- 机会按可见范围隔离：同校可见与全网可见分别判定，外部访客只能读取公开视图。
- 组织 Agent 只能检索组织范围数据；私人资料不会进入组织输出。
- 行动确认前不发布机会；成员被移除后旧草稿确认被严格阻断。
- `opportunities` 与 `actions` 表 FORCE RLS；普通连接池不能绕过。

## 已知限制

- **正式双端设计评审未进行**：M1-07 仍是可点击原型，界面状态矩阵尚未经过评审门。
- 组织认证审核流未实现（`organization_verification_status` 字段存在但没有审核流程）。
- 机会页面为 Web 控制台；移动端无任何界面（`apps/mobile` 只有首页骨架）。
- 组织 Agent 使用 Mock Provider，真实 Provider 未接入。
- 收件箱为占位页，引荐收件箱的真实数据流在 M5 才有 API，页面尚未接线。
- 没有组织报表、批量导入与机会附件。

## 下一步

- M1-07 正式双端设计评审 → 解锁个人页面与组件层编码。
- M5 组织控制台的引荐收件箱与关系视图接线。
- 组织认证审核流程与真实 Provider 接入。
