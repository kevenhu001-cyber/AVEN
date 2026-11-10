# ADR-004：数据授权与 RLS

- 状态：已接受（M0-05 验证）
- 日期：2026-11-10
- 相关：[TDD](../TDD.md) · [SCHEMA](../../database/SCHEMA.md)

## 背景

AVEN 处理个人记忆、组织资料、授权快照和关系空间。只在应用层做权限检查不够：一次遗漏查询、一个后台任务或连接池串身份都可能造成越权。原规格要求 PostgreSQL RLS 作为纵深防御，并使用不绕过 RLS 的运行角色。

## 决策

1. 所有多租户/私人表启用 RLS，并 `FORCE ROW LEVEL SECURITY`。
2. 应用请求使用 `aven_app`：`NOSUPERUSER`、`NOBYPASSRLS`、无 DDL。
3. 每个事务用 `SET LOCAL` 绑定 `app.principal_id`、`app.user_id`、`app.organization_id`、`app.is_platform_admin`、`app.is_worker`、`app.request_id`。
4. 禁止 session 级 `SET`；所有数据库访问通过 `packages/database` 的事务包装器。
5. 策略默认拒绝；辅助函数 `app.current_principal_id()`、`app.is_org_member()`、`app.is_org_admin()`、`app.is_relationship_member()`、`app.is_platform_admin()` 统一判断。
6. 登录/会话查找使用最小权限的 `SECURITY DEFINER` 函数；`aven_app` 不能直接读取密码哈希或会话 token 哈希。
7. Worker 使用系统主体 + `app.is_worker=true`；作业携带 actor 上下文，领域服务执行时再次校验。
8. 授权读取对 grant 行加 `FOR SHARE`，撤销使用 `FOR UPDATE`，避免撤销提交后仍返回旧内容。
9. 集成测试必须用 `aven_app` 连接，覆盖两用户、两组织、连接池复用和跨租户访问。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 仅应用层权限 | 简单 | 一次遗漏即越权，无法防后台任务 | 不采用 |
| 超级用户 + 应用过滤 | 性能简单 | 完全绕过 RLS，风险最高 | 不采用 |
| 每租户独立 schema/数据库 | 强隔离 | 迁移和运维复杂，首版过度 | 不采用 |
| RLS + 资源级检查 | 纵深防御 | 策略复杂、调试成本 | 采用 |

## 后果

- 所有查询必须在事务内并设置上下文；连接池复用要清理。
- RLS 策略和辅助函数需要随迁移一起维护。
- 复杂策略可能影响性能，需要索引和查询计划检查。
- 调试需要能看到当前 actor 上下文；日志不能泄露敏感值。
- 迁移角色和应用角色必须分离；生产连接串不能使用迁移角色。

## 验证

- [ ] 空库迁移创建角色、策略和函数。
- [ ] `aven_app` 无法 `SET ROLE` 到超级用户或绕过 RLS。
- [ ] 两个用户/两个组织的读写隔离测试通过。
- [ ] 连接池复用不残留上一请求身份。
- [ ] 被移除成员、低权限成员、伪造组织 ID 被拒绝。
- [ ] 撤销后共享上下文读取被拒绝。
