# @aven/database

D1 身份与组织表的 Drizzle Schema、版本化 SQL 迁移、开发 seed 与数据库验证。当前只覆盖 D1；D2–D6 业务表随对应模块交付。

## 命令

在仓库根目录执行：

```bash
corepack pnpm db:status          # 已应用/待应用迁移
corepack pnpm db:migrate         # 使用 aven_migrator 应用迁移
corepack pnpm db:seed            # 显式开发 seed，可重复执行
corepack pnpm db:verify          # 重建 aven_test，验证空库迁移、升级、seed 与 RLS
corepack pnpm db:verify:current  # 只验证当前 POSTGRES_DB
```

`db:verify` 会删除并重建 `aven_test`，只用于开发/CI，不能指向共享或生产数据库。

## 迁移规则

- 文件位于 `migrations/`，按文件名排序执行，例如 `0004_opportunity.sql`。
- 每个迁移在单个事务中执行；不要使用 `CREATE INDEX CONCURRENTLY` 或事务外 DDL。
- runner 在 `app.schema_migrations` 记录版本、SHA-256 校验和、执行时间。
- 已应用迁移不可修改；校验和不一致会拒绝继续。修正必须新增迁移。
- `--to <tag>` 只应用到指定版本，用于验证“已有库升级”路径。
- 迁移必须同时交付索引、约束、RLS 与必要权限；可选扩展不得进入基础迁移。
- 表结构可用 Drizzle Kit 生成草稿，但触发器、RLS、函数和权限以人工审查的 SQL 为准。当前未保留 Drizzle Kit journal，因此不提供自动生成脚本。

## 角色

| 用途 | 角色 | 说明 |
|---|---|---|
| 迁移 | `aven_migrator` | schema/表所有者；可转移函数所有权给 `aven_function_owner`；不用于请求 |
| 业务请求 | `aven_app` | 仅列级 SELECT 与受控函数；无 DDL、无写权限（M2 再逐项开放） |
| Worker | `aven_worker` | 当前无表权限；M0-07/M3 按任务开放 |
| 认证 | `aven_auth` | 当前无表权限；M2 只开放认证函数 |
| 函数所有者 | `aven_function_owner` | NOLOGIN；持有安全定义函数；仅成员表/平台角色的显式 SELECT 策略 |

`aven_migrator` 是 `aven_function_owner` 的成员，用于 `ALTER FUNCTION ... OWNER TO`；运行角色没有任何成员关系。

## 当前 RLS 状态

- 13 张 D1 表均启用 RLS；`aven_app` 没有写权限，越权写入在权限层直接失败。
- 已交付读策略：本人主体/用户/私有邮箱/会话、公开组织资料、认证用户校园、同组织成员关系、组织管理员邀请。
- 尚未 `FORCE ROW LEVEL SECURITY`：表所有者（迁移角色）仍可执行 seed 和维护；M2 在补齐写策略与受控函数后切换 FORCE。
- 尚未交付注册、登录、会话创建/撤销、邀请接受等写路径与认证函数；M2 负责。
- `credentials`、`sessions.token_hash`、验证/重置 token 对 `aven_app` 无权限。
- 函数使用固定 `search_path`，`PUBLIC` 无 EXECUTE；安全定义函数由 `aven_function_owner` 持有。

## 开发 seed

`src/seed.ts` 写入明确标记的开发样例：一个校园、两个用户、两个组织、三条成员关系。邮箱使用 `.test` 保留域，校园成员状态为 `pending`，组织认证状态为 `unverified`；不包含真实用户、真实认证或密码凭据。登录与密码哈希在 M2 实现前不存在。

## 未实现

D2–D6 表、写策略、`FORCE RLS`、认证/会话函数、Outbox/Audit、连接池接入 API/Worker、备份恢复与生产迁移流程。
