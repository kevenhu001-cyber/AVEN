# M2-05 跨账号与跨组织隔离验证

日期：2026-11-11 · 状态：21 项真实 HTTP/数据库隔离检查通过；并发竞争、生产多实例与真实设备未验证

## 范围

本轮验证 M2 身份/组织基础在真实 API、PostgreSQL 与连接池上的隔离：两个组织、三个用户（owner/member/cross-owner）、同组织读取、跨组织拒绝、伪造主体头、邀请邮箱不匹配、成员移除、连接池上下文复用与 `FORCE RLS` 下的上下文清理。

## 场景

| 场景 | 断言 |
|---|---|
| 同组织成员 | 组织一成员可读组织一详情/成员 |
| 跨组织成员 | 组织一成员不能读组织二详情/成员 |
| 跨组织 owner | 组织二 owner 不能读组织一 |
| 普通成员权限 | 不能邀请、不能改 owner 角色、不能移除 owner |
| 跨组织写 | 组织二 owner 不能向组织一邀请 |
| 伪造主体头 | 客户端 `x-user-id`/`x-principal-id` 被忽略，仍返回本人组织 |
| 邀请邮箱 | 邀请 token 不能被其他邮箱接受 |
| 成员移除 | 移除后旧会话不能读组织详情/成员列表 |
| 连接池复用 | A/C 上下文各自只看到自己的 active membership；无上下文连接看不到成员关系 |
| 上下文清理 | 事务提交后 `app.user_id` 为空 |
| 主体错配 | principal/user 上下文不一致时不能读取另一 principal |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm isolation:verify` | 21/21 通过；真实 HTTP、PostgreSQL、Redis 限流清理与连接池 |
| `corepack pnpm db:verify` | 63 项通过；18 张表强制 RLS、`row_security=off` 拒绝 |
| `corepack pnpm test` | 62/62 通过 |
| `corepack pnpm typecheck` / `build` | 18/18 与 11/11 Turbo tasks 通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查通过 |

## 关键结论

- 跨组织读取/写入在 API 与数据库函数层均被拒绝；不是只靠前端隐藏。
- 客户端传入的主体/组织 ID 不作为权限依据；服务端从会话派生 `app.user_id`/`app.principal_id`。
- 连接池使用事务本地 `set_config(..., true)`，提交后不残留身份；无上下文连接受 RLS 默认拒绝。
- 成员移除后旧会话仍可认证，但不能继续读取组织资源；会话撤销与成员移除是独立控制。
- `FORCE RLS` 下认证、资料、组织、Outbox/Worker 流程仍通过既有验证。

## 已知限制

- 未覆盖并发接受邀请、并发移除/角色变更、死锁重试、连接池高并发与多实例。
- 未覆盖真实 Android/iOS 会话、深链、后台恢复与 Secure Storage。
- 未覆盖组织所有权转让、校园审核、审计日志与生产备份恢复。
- 测试使用开发邮件 sink 与本地 Compose；不代表生产邮件、网络或数据位置已验证。
- `FORCE RLS` 的性能与索引计划未审计；真实数据前需压测与慢查询检查。
