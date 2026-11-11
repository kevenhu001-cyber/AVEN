# M2-04 授权基础设施与强制 RLS

日期：2026-11-11 · 状态：`FORCE ROW LEVEL SECURITY`、迁移角色例外、非绕过运行角色与隔离验证已完成；生产级 RLS 性能/运维未验证

## 范围

本轮在已有 RLS 策略、事务本地上下文和 `SECURITY DEFINER` 写函数基础上，强制所有租户/用户数据表启用 `FORCE ROW LEVEL SECURITY`。运行角色仍无 DDL、无 `BYPASSRLS`、无任意表写权限；写操作继续通过受控函数。迁移角色 `aven_migrator` 获得显式 `FOR ALL` 策略，仅用于迁移与 seed，不作为请求角色。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0010_force_rls.sql` | 18 张表的 `FORCE ROW LEVEL SECURITY` 与 `aven_migrator` 显式策略 |
| `packages/database/src/verify.ts` | `relforcerowsecurity` 计数、`row_security=off` 拒绝、既有角色/函数检查 |
| `apps/api/src/http-errors.ts` | 数据库错误码到 401/403/404/409/422 的统一映射 |
| `scripts/isolation-verify.ts` | 跨账号/跨组织与连接池上下文隔离验证 |

## 强制 RLS 表

`principals`、`users`、`user_private`、`credentials`、`sessions`、`email_verification_tokens`、`password_reset_tokens`、`campuses`、`campus_memberships`、`organizations`、`organization_memberships`、`organization_invitations`、`platform_role_assignments`、`outbox_events`、`job_receipts`、`sample_tasks`、`sample_task_results`、`sample_external_effects`。

- 表所有者（`aven_migrator`）在 `FORCE` 下也受 RLS 约束；迁移显式添加 `aven_migrator` 策略，保证 seed/维护可用。
- 运行角色 `aven_app`、`aven_worker`、`aven_auth` 没有 `BYPASSRLS`、没有 DDL、没有全 schema DML。
- 认证、资料、校园、组织写操作只通过 `aven_function_owner` 持有的受控函数；函数使用事务本地 `app.user_id`。
- `row_security=off` 不能绕过策略；测试确认普通池执行会被拒绝。

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm db:verify` | 63 项通过；10 个迁移、18 张表强制 RLS、`row_security=off` 拒绝、既有角色/函数检查 |
| `corepack pnpm auth:verify` | 42/42 通过；强制 RLS 后认证函数仍可用 |
| `corepack pnpm profile:verify` | 16/16 通过 |
| `corepack pnpm organization:verify` | 31/31 通过 |
| `corepack pnpm async:verify` | 29/29 通过；Outbox/Worker 在强制 RLS 下仍可用 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查通过 |

## 已知限制

- 没有为普通运行角色开放直接表写；所有写路径依赖受控函数，新增写入口必须同时交付函数、策略与测试。
- `aven_migrator` 的 `FOR ALL` 策略是显式迁移例外；生产迁移凭据必须严格隔离，不能用于请求。
- 未做 RLS 查询计划/索引性能审计、连接池高并发压测、多实例故障演练或生产数据库验证。
- 未实现组织上下文 `X-Organization-Id` 的通用中间件；当前组织函数用路径 ID + 成员校验，后续组织控制台接入时补齐。
- 未实现 `FORCE RLS` 下的备份/恢复与迁移回滚演练。
