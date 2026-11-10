# M0-05 迁移与开发数据

日期：2026-11-11 · 状态：迁移流程、D1 表、读策略与开发 seed 已验证；M2 写路径与 FORCE RLS 未实现

## 范围

本轮建立唯一迁移入口 `packages/database/migrations`、校验和 runner、D1 身份与组织表、只读 RLS 策略、显式开发 seed 和验证脚本。D2–D6 业务表、认证/会话写函数、Outbox/Audit、API/Worker 连接池与生产迁移流程不在本轮。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0001_identity_organization.sql` | 11 个 D1 枚举、13 张表、外键、唯一/部分索引与检查约束 |
| `packages/database/migrations/0002_identity_organization_hardening.sql` | `app` schema、更新时间/主体类型触发器、上下文与组织辅助函数、RLS 读策略、列级授权、seed 记录表 |
| `packages/database/migrations/0003_function_owner_execute.sql` | 安全定义函数所有者调用上下文函数所需的 EXECUTE |
| `packages/database/src/migrate.ts` | 事务化 runner、SHA-256 校验和、`--to` 升级路径、`--status` |
| `packages/database/src/seed.ts` | 可重复执行的开发 seed |
| `packages/database/src/verify.ts` | 表/约束/RLS/函数/seed 验证 |
| `packages/database/src/index.ts` | Drizzle Schema 导出、按角色连接池、事务内请求上下文 |
| `scripts/db-verify.mjs` | 重建 `aven_test`，验证空库迁移、已有库升级、seed 幂等与 RLS |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm db:verify` | 通过；空库先应用 `0001`，再应用 `0002/0003`；seed 与迁移重复执行均幂等；36 项数据库检查通过 |
| `corepack pnpm db:verify:current` | 通过；当前 `aven` 库同样通过 36 项检查 |
| 修改已应用迁移后运行 `db:migrate` | 按预期拒绝：`changed after it was applied. Add a new migration instead of editing history.` |
| `corepack pnpm infra:verify` | 通过；角色隔离、Redis 认证与持久化检查 |

覆盖的关键检查：

- 13 张 D1 表存在，全部启用 RLS。
- `aven_app` 不能读 `credentials`、`sessions.token_hash`、`platform_role_assignments`，不能插入/更新/删除 `principals`。
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

- `aven_app` 只有列级 SELECT 和辅助函数 EXECUTE；没有 INSERT/UPDATE/DELETE。
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

- 未实现 D2–D6 表、机会/引荐/授权/关系/Agent/Outbox/Audit。
- 未实现注册、登录、会话、邀请接受、组织写操作与 `FORCE RLS`。
- 就绪探针已接入 API/Worker（M0-06）；业务连接池与认证池仍待 M2。
- 未验证生产迁移、备份恢复、扩展启用（pgvector/PostGIS）或大表回填。
- `aven_test` 由 `db:verify` 重建；不要在其中保存需要保留的数据。
