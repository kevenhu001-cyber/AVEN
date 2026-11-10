# ADR-003：数据运行环境

- 状态：已接受（M0-04 验证）
- 日期：2026-11-10
- 相关：[TDD](../TDD.md) · [SCHEMA](../../database/SCHEMA.md)

## 背景

开发需要 PostgreSQL、pgvector、PostGIS 和 Redis。2026-11-10 检测到 Docker 29.1.3 可用，本机有 PostgreSQL 16 客户端但没有 Redis。原 README 记录“未找到 Docker”已过时。

首个试点在中国校园网络，生产部署位置未定；开发环境不能假定海外托管服务可用。

## 决策

1. 开发环境使用 **Docker Compose** 启动：
   - PostgreSQL 17（或经官方验证的稳定版本）
   - pgvector
   - PostGIS
   - Redis 7
2. 使用命名 volume 持久化；配置 healthcheck；端口只绑定本机。
3. 数据库初始化创建 `aven_migrator` 和 `aven_app` 角色；应用不使用超级用户。
4. 提供 `.env.example`；真实密码不入库；开发密码只用于本地。
5. 如果镜像不能同时提供 pgvector 和 PostGIS，使用自定义 Dockerfile 在官方 PostGIS 镜像上安装 pgvector，或选择经验证的社区镜像；记录来源和版本。
6. 本机 PostgreSQL 16 只作为排障备选，不作为团队标准；Redis 必须通过 Compose 提供。
7. 生产部署位置、托管方式和合规要求在 M7 前单独决策。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Docker Compose | 可复现、隔离、CI 可用 | 镜像体积、内存占用 | 采用 |
| 本机 PostgreSQL + 本地 Redis | 启动快 | 环境漂移、扩展安装不一致 | 备选 |
| Supabase 本地/云 | 自带扩展与工具 | 依赖外部平台，生产位置待定 | 不作为首版基线 |
| 云托管 PostgreSQL | 运维少 | 成本、网络、合规未定 | M7 再评估 |

## 后果

- 开发者需要 Docker；CI 使用 service containers 或 Compose。
- 镜像和 volume 占用磁盘；本机 17 GB 可用空间需要监控。
- 数据库扩展版本必须与迁移和 pgvector 查询兼容。
- 生产迁移不能直接复用开发密码或角色配置。

## 验证

- [ ] `docker compose up -d` 后 PostgreSQL/Redis 健康。
- [ ] `CREATE EXTENSION vector` 和 `CREATE EXTENSION postgis` 成功。
- [ ] 空库迁移成功。
- [ ] `aven_app` 能连接但不能执行 DDL/绕过 RLS。
- [ ] 文档记录实际镜像 tag、端口、卷和故障处理。
