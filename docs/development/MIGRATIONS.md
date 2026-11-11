# M0-05 迁移与开发数据

日期：2026-11-11 · 状态：迁移流程、D1 表、异步样例表、读策略、开发 seed、M2 写路径、FORCE RLS 与 M3-02 记忆复核已实现；生命周期清理与生产迁移流程未实现

## 范围

本轮建立唯一迁移入口 `packages/database/migrations`、校验和 runner、D1 身份与组织表、Outbox/回执/样例表、只读 RLS 策略、显式开发 seed 和验证脚本。D2–D6 业务表、认证/会话写函数、Audit、业务队列与生产迁移流程不在本轮。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0001_identity_organization.sql` | 11 个 D1 枚举、13 张表、外键、唯一/部分索引与检查约束 |
| `packages/database/migrations/0002_identity_organization_hardening.sql` | `app` schema、更新时间/主体类型触发器、上下文与组织辅助函数、RLS 读策略、列级授权、seed 记录表 |
| `packages/database/migrations/0003_function_owner_execute.sql` | 安全定义函数所有者调用上下文函数所需的 EXECUTE |
| `packages/database/migrations/0004_readiness_schema_version.sql` | 就绪探针只读迁移版本 |
| `packages/database/migrations/0005_outbox_and_sample_task.sql` | Outbox、消费回执、样例任务/结果/外部效果表、RLS 与列级授权 |
| `packages/database/migrations/0006_outbox_available_at_grant.sql` | Worker 回退待处理事件所需的 `available_at` 更新权限 |
| `packages/database/migrations/0007_authentication.sql` | 会话 CSRF 哈希、邮箱规范化约束、13 个认证函数、函数所有权、RLS 与角色授权 |
| `packages/database/migrations/0008_profile_and_campus.sql` | 资料更新、校园列表、本人校园成员与 pending 申请函数、函数所有权与授权 |
| `packages/database/migrations/0009_organizations.sql` | 组织创建、成员、邀请/接受、角色、移除/离开与最后 owner 保护函数 |
| `packages/database/migrations/0010_force_rls.sql` | 18 张表 `FORCE ROW LEVEL SECURITY` 与迁移角色显式策略 |
| `packages/database/migrations/0011_memory.sql` | 记忆/来源/字段策略表、所有权触发器、FORCE RLS、6 个记忆函数与授权 |
| `packages/database/migrations/0012_memory_review.sql` | 候选唯一索引、来源片段约束、主列表 confirmed 过滤、可编辑状态限制、5 个复核函数与授权 |
| `packages/database/src/migrate.ts` | 事务化 runner、SHA-256 校验和、`--to` 升级路径、`--status` |
| `packages/database/src/seed.ts` | 可重复执行的开发 seed |
| `packages/database/src/verify.ts` | 表/约束/RLS/函数/seed 验证 |
| `packages/database/src/index.ts` | Drizzle Schema 导出、按角色连接池、事务内请求上下文 |
| `scripts/db-verify.mjs` | 重建 `aven_test`，验证空库迁移、已有库升级、seed 幂等与 RLS |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm db:verify` | 通过；空库先应用 `0001`，再应用剩余迁移；seed 与迁移重复执行均幂等；92 项数据库检查通过 |
| `corepack pnpm db:verify:current` | 通过；当前 `aven` 库同样通过 92 项检查 |
| 修改已应用迁移后运行 `db:migrate` | 按预期拒绝：`changed after it was applied. Add a new migration instead of editing history.` |
| `corepack pnpm infra:verify` | 通过；角色隔离、Redis 认证与持久化检查 |

覆盖的关键检查：

- 13 张 D1 表存在，全部启用 RLS；`outbox_events`、`job_receipts` 存在并启用 RLS。
- 13 个认证函数存在且由 `aven_function_owner` 持有；`aven_app` 不能执行认证查找/会话创建，`aven_auth` 不能直接读 `principals`。
- 4 个资料/校园函数存在且由 `aven_function_owner` 持有；无用户上下文拒绝资料更新；本人校园成员列表与 pending 申请幂等；资料更新递增 principal version。
- 10 个组织函数存在且由 `aven_function_owner` 持有；创建者成为 owner；admin 不能改 owner；最后 owner 不能离开；组织成员列表与创建流程可用。
- 18 张租户/用户数据表启用 `FORCE ROW LEVEL SECURITY`；普通池不能通过 `row_security=off` 绕过；迁移角色有显式维护策略。
- 6 个记忆函数存在且由 `aven_function_owner` 持有；记忆 owner 必须为当前用户；来源/策略所有权触发器生效；跨用户读取/更新拒绝；软删除后不可读。
- 11 个记忆函数存在且由 `aven_function_owner` 持有；候选创建为 pending、主列表只返回 confirmed、候选队列带来源、确认/拒绝状态转换、用途检索门、默认拒绝与跨用户拒绝均通过。
- `aven_app` 不能读 `credentials`、`sessions.token_hash`、`platform_role_assignments`、`outbox_events.payload`，不能插入/更新/删除 `principals`。
- 无上下文时看不到用户主体、校园、成员关系；公开组织资料可见。
- 用户只能看本人主体、私有邮箱和会话；同组织成员关系按组织隔离。
- `app.is_org_member`、`is_org_admin`、`can_represent`、`is_verified_campus_member`、`is_platform_admin` 返回预期结果。
- 空显示名、重复邮箱、第二活跃 owner、owner 邀请、未带验证时间的 verified 校园成员、用户引用组织主体均被拒绝。
- `updated_at` 触发器生效。

## 迁移流程

```bash
corepack pnpm infra:up
corepack pnpm db:status
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm db:verify
```

- 迁移使用 `aven_migrator`，请求不得使用该角色。
- runner 在 `app.schema_migrations` 记录版本、校验和与执行时间；已应用文件不可修改。
- `--to <tag>` 用于验证已有库升级；`db:verify` 会先只应用 `0001`，再应用剩余迁移。
- 迁移在事务中执行，`lock_timeout=5s`、`statement_timeout=120s`；不支持事务外 DDL。
- 失败时事务回滚，修复通过新增迁移完成；不要求每条 DDL 可逆。

## RLS 与权限边界

- `aven_app` 对 D1 表只有列级 SELECT 和辅助函数 EXECUTE；对异步样例只有 `sample_tasks`/`outbox_events` 的受控 INSERT 与最小 SELECT，不能读取 Outbox payload。
- `aven_worker` 只获得租约领取、回执、样例结果/外部效果所需的列级权限；不能读取 D1 私有表。
- `credentials`、token 哈希、`sessions.token_hash`、`platform_role_assignments` 不对普通池开放。
- 安全定义函数由 `aven_function_owner` 持有，固定 `search_path`，`PUBLIC` 无 EXECUTE；函数所有者仅拥有成员表/平台角色的显式 SELECT 策略。
- 当前仅 `ENABLE ROW LEVEL SECURITY`，未 `FORCE`；表所有者仍可 seed/维护。M2 补齐写策略与受控函数后切换 FORCE，并增加连接池复用隔离测试。
- 组织资料的 `USING (true)` 是公开投影；用户主体、私有邮箱、会话仍按本人过滤。

## 开发 seed

- 一个校园、两个用户、两个组织、三条成员关系。
- 邮箱为 `dev.user1@example.test` / `dev.user2@example.test`，使用保留域。
- 校园成员为 `pending`，组织认证为 `unverified`；不伪造官方认证。
- 不含密码凭据；M2 认证实现前无法登录。
- `app.development_seed_runs` 记录 seed 版本，重复执行跳过。

## 已知限制

- 未实现 D2–D6 表、机会/引荐/授权/关系/Agent/Audit。
- Outbox/回执仅用于工程样例；业务队列、死信运维、指标与 exactly-once 未实现。
- 认证函数已实现会话/邮箱验证/密码重置；生产邮件、MFA、账号锁定、空闲超时与真实设备未实现。
- 资料更新与校园申请函数已实现；校园审核、邮件域名验证与真实页面未实现。
- 组织创建/成员/邀请/角色/离开已实现；所有权转让、组织认证审核、审计日志与邀请清理任务未实现。
- 21 张表已强制 RLS；普通运行角色仍无直接表写，写操作只通过受控函数。M2-05 已覆盖跨账号/跨组织与连接池上下文。
- 手工确认记忆、来源与字段策略已实现；候选提取/确认/拒绝与用途检索门已实现；生命周期清理、组织记忆、向量与共享授权未实现。
- `0012_memory_review.sql` 的 pending 唯一索引要求升级前不存在重复 pending 候选；若存在，迁移会失败并回滚，需要先人工合并。来源片段约束会校验既有行，生产大表应改为 `NOT VALID` + 分批 `VALIDATE`。
- 未验证 RLS 查询计划/索引性能、生产备份恢复、迁移回滚或高并发多实例。
- `aven_test` 由 `db:verify` 重建；不要在其中保存需要保留的数据。
