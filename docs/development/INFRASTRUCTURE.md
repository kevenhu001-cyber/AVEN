# M0-04 开发基础设施

日期：2026-11-11 · 状态：本地 Compose 与角色验证通过；D1 迁移见 [MIGRATIONS.md](MIGRATIONS.md)；API/Worker 连接池与扩展启用未实现

## 范围

本轮只提供开发环境的 PostgreSQL 与 Redis、环境模板、数据库角色和验证脚本。D1 表、迁移与 seed 已在 M0-05 交付；业务 API、API/Worker 数据库连接、就绪探针依赖检查与 CI 服务容器仍未实现，不能据此宣称数据库层或业务可用。

按 [ADR-008](../architecture/decisions/0008-progressive-delivery.md)，基础环境不预装 pgvector/PostGIS，也不制作组合镜像。语义检索与真实地理查询出现时，分别通过独立迁移和启用门验证。

## 组件与版本

| 组件 | 镜像/版本 | 本机地址 | 持久化 |
|---|---|---|---|
| PostgreSQL | `postgres:17.11-alpine3.24`（digest `sha256:3540c036…0302ac`） | `127.0.0.1:55432` | 命名卷 `aven-dev_aven-postgres-data` |
| Redis | `redis:7.4.12-alpine`（digest `sha256:7b1753b4…a384b7`） | `127.0.0.1:6379` | 命名卷 `aven-dev_aven-redis-data` |

本机 5432 已被其他 PostgreSQL 占用，因此 Compose 默认映射 55432，避免停止或修改宿主机服务。两个端口都只绑定 `127.0.0.1`，不暴露到局域网。

PostgreSQL 参数：`shared_buffers=128MB`、`max_connections=50`、`password_encryption=scram-sha-256`、慢查询日志阈值 500 ms。Redis 参数：AOF `everysec`、`maxmemory 128mb`、`maxmemory-policy noeviction`，避免队列/任务键被缓存淘汰。

## 启动与验证

```bash
cp .env.example .env
corepack pnpm infra:up       # docker compose up -d --wait
corepack pnpm infra:verify   # 角色隔离、Redis 认证与持久化配置
corepack pnpm infra:status
corepack pnpm infra:down
corepack pnpm infra:reset    # 删除本地卷，所有开发数据丢失
```

`.env` 已被 `.gitignore` 排除；`.env.example` 只含开发占位密码。共享机器或任何真实数据环境必须替换全部密码，且不能复用这里的值。

## 角色与连接边界

| 角色 | 登录 | 权限 |
|---|---|---|
| `aven_migrator` | 是 | 数据库与 `public` schema 所有者；DDL；只用于迁移，不用于请求 |
| `aven_app` | 是 | 仅 `CONNECT` 与 schema `USAGE`；无 DDL、无 `CREATEDB`、无 `CREATEROLE`、无 `BYPASSRLS` |
| `aven_worker` | 是 | 同上；后续按任务授予逐表权限 |
| `aven_auth` | 是 | 同上；后续只授予认证受控函数 |
| `aven_function_owner` | 否 | NOLOGIN；后续持有受控函数，非表所有者，无 `BYPASSRLS` |

- 应用角色之间没有显式成员关系，不能 `SET ROLE` 到 `aven_migrator`。
- `PUBLIC` 对 `aven`、`aven_test`、`postgres`、`template1` 的默认连接权限已收回；应用角色不能连接 `postgres` 维护库。
- `aven_test` 已创建并归 `aven_migrator` 所有，供后续集成测试使用。
- 数据库连接串在 M0-05/M0-06 接入；请求处理禁止使用 `aven_migrator`。
- 当前没有表级授权或 RLS；这些必须随 M0-05/M2 的迁移一起交付。

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `node scripts/infra.mjs up` | PostgreSQL 与 Redis 均启动并通过 healthcheck |
| `node scripts/verify-infra.mjs` | 18 项全部 PASS（见下） |
| 重启容器后查询探针表/键 | PostgreSQL 表数据与 Redis 键均保留 |
| `node scripts/infra.mjs down` | 容器停止，命名卷保留 |

`verify-infra.mjs` 覆盖：

1. `aven_migrator` 与 `aven_app` 能通过 TCP + SCRAM 连接。
2. `aven_app` 的 `rolsuper/rolcreatedb/rolcreaterole/rolbypassrls` 均为 false。
3. `aven_app` 不能建表、不能建库、不能 `SET ROLE`、不能读 `pg_authid`、不能连接 `postgres` 库。
4. `aven_app` 不能创建可选 `vector` 扩展。
5. `aven_migrator` 能在事务内建表并回滚。
6. `aven_function_owner` 为 NOLOGIN；`aven_*` 角色无显式成员关系。
7. `aven_test` 存在；`vector`/`postgis` 未预装。
8. Redis 正确密码返回 `PONG`，无密码命令返回 `NOAUTH`，AOF 开启且淘汰策略为 `noeviction`。

## 扩展启用门

- pgvector：语义模块迁移前，用独立迁移创建扩展并验证版本、维度和索引；基础迁移不得出现 `vector(n)`。
- PostGIS：真实地理查询出现后单独决策、安装和迁移。
- 扩展由有权限的部署引导流程创建；`aven_migrator` 与所有运行角色都没有 `CREATE EXTENSION` 权限。
- 当前镜像不包含扩展控制文件，因此 `CREATE EXTENSION` 会因权限或文件缺失失败；这是预期状态，不是缺陷。

## 已知限制

- 未在 CI 之外的全新机器复验；CI 已增加 `infrastructure` job，使用 `.env.example` 启动、验证角色并运行 `db:verify`。
- 未实现 API/Worker 连接池、就绪探针、数据库备份恢复或生产迁移流程。
- Redis 密码通过容器环境变量传入，开发环境可接受；生产必须使用 Secret Manager 和受控网络。
- 本机 3.6 GiB 内存，同时运行 PostgreSQL、Redis、Next、Nest 与 Metro 时需限制并发。
