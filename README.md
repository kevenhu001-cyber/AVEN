# AVEN

AVEN 是面向个人与组织的 AI 连接网络，首个试点场景为西安交通大学。产品围绕个人上下文、组织资源、经授权的机会匹配，以及真实合作与活动协调展开。

## 当前状态

项目处于 **M0 基础工程**阶段。已完成 **M0-01：最小产品与工程文档**、**M0-02：依赖与运行时**、**M0-04：开发基础设施**；**M0-03：应用与共享包**的 Web/API/Worker/Expo 骨架已建立并通过实际构建，但 Expo Go 真机连接与原生流式探针尚未执行。数据库迁移、业务 API、AI 与核心产品 UI 仍未实现，M0 与 MVP 均未完成。

原始规格使用 PAN（Personal AI Network）作为代号。仓库及后续工程文档使用 AVEN，原始文档保留原文供追溯。

## 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent/开发者必读规则、目录边界、安全与交付要求 |
| [PRD](docs/product/PRD.md) | 产品范围、首条旅程、可见性、页面与 MVP DoD 映射 |
| [设计系统](docs/design/DESIGN_SYSTEM.md) | 令牌、布局、组件、适用状态、无障碍 |
| [核心旅程界面契约](docs/design/CORE_JOURNEY.md) | 关键页面层级、双端交互、高保真与原型验收门 |
| [TDD](docs/architecture/TDD.md) | 模块边界、身份、授权、状态机、事务、异步、API 与测试 |
| [SCHEMA](docs/database/SCHEMA.md) | 首批表、约束、索引、RLS、迁移与数据保留 |
| [API 契约](docs/api/README.md) / [核心端点](docs/api/CORE_CONTRACTS.md) | 预览、独立引荐、授权读取、Agent 创建/订阅与验收 |
| [ADR](docs/architecture/decisions/) | 运行时、身份、数据运行、RLS、Outbox、AI Provider 决策 |
| [详细开发计划](docs/development/DEVELOPMENT_PLAN.md) | 阶段任务、依赖、接口与真实数据准入门 |
| [工程骨架交付记录](docs/development/FOUNDATION_REPORT.md) | M0-02/03 版本依据、实际验证命令、未完成项 |
| [开发基础设施](docs/development/INFRASTRUCTURE.md) | Compose、PostgreSQL/Redis、数据库角色与验证门 |
| [契约修订记录](docs/development/CONTRACT_REVIEW.md) | 1.1 变更、静态检查与未验证事项 |
| [开发启动建议](docs/development/START_HERE.md) | 首次工作区评估与启动思路 |
| [原始产品与工程规格](Origin%20Plan.md) | 产品范围、设计系统、技术方向和完整 MVP 要求 |

## 首条交付主线

组织发布机会 → 个人发现机会 → 预览并授权共享资料 → 双方确认 → 建立关系空间 → 撤销授权后停止相关访问。

该主线是首个业务验收目标；完整 MVP 还包含个人与组织 AI、记忆管理、Android、日程协调和运行保障。

## 技术方向

| 范围 | 计划采用 |
|---|---|
| 工程 | TypeScript strict 6.0.3、pnpm 12.18.0、Turborepo 2.11.10、Node 24.19.0（已实际构建验证） |
| Web | Next.js 16.4.6 App Router、React 19.3、Tailwind CSS 4.3、Lucide（组件库待 M1） |
| 原生移动端 | Expo SDK 58 / React Native 0.88 / Expo Router；Expo Go 早期连接，development build 主线，发布包复验 |
| 后端 | NestJS 12.4.2 模块化单体、REST、SSE |
| 数据与任务 | PostgreSQL、Drizzle、Redis、BullMQ；pgvector 语义模块前启用，PostGIS 按需 |
| 身份 | 自建邮箱 + 密码、Argon2id、不透明会话、RLS |
| AI | 可替换 Provider、默认 Mock、OpenAI-compatible 适配器、显式行动确认 |
| 验证 | Zod 4.6.7、Vitest 5.1、Playwright 1.65、Maestro |

具体版本、部署环境和真实 AI Provider 在对应阶段验证并记录，不在规划阶段假定兼容性。1.1 重点修正字段用途、候选/引荐隔离、最小数据库权限、授权与流式恢复语义；使用真实数据前须完成网络/数据处理边界和恢复演练。

## 开发入口

下一项任务是 **M0-05：迁移及测试数据**，建立 Drizzle 迁移流程、空库迁移与显式开发 seed；M0-03 的真机 Expo Go 连接与原生流式探针待有设备环境后补验。核心旅程高保真/原型可作为 M1-07 并行设计，目前尚未交付。

开始前请阅读 [AGENTS.md](AGENTS.md) 和 [TDD](docs/architecture/TDD.md)。M0-02/03 的版本、构建与限制见 [工程骨架交付记录](docs/development/FOUNDATION_REPORT.md)，M0-04 的 Compose/角色验证见 [开发基础设施](docs/development/INFRASTRUCTURE.md)。

## 环境现状

截至 2026-11-10 实际检测：

| 项 | 状态 |
|---|---|
| Node | v24.19.0 |
| npm | 11.17.0 |
| pnpm | 12.18.0（Corepack 激活） |
| Docker | 29.1.3，可用 |
| PostgreSQL 客户端 | 16.14；服务端通过 Compose 运行 17.11（127.0.0.1:55432） |
| Redis | 通过 Compose 运行 7.4.12（127.0.0.1:6379，需密码） |
| Android SDK/adb | 未安装；开发期用真机 Expo Go |
| 资源 | 4 核 / 3.6 GB 内存 / 约 15 GB 可用磁盘 |

Next 16.4.6、Nest 12.4.2、Expo SDK 58 与 Node 24.19.0 的最小安装、类型检查和生产构建已实际通过；PostgreSQL/Redis 启动、角色隔离与持久化已实际验证。数据库扩展镜像、真机连接、迁移与 CI 尚未验证。M0-05 必须实际执行空库迁移并更新本文。

## 开发命令

以下命令已在 2026-11-10 实际执行并通过，详细结果见 [工程骨架交付记录](docs/development/FOUNDATION_REPORT.md)：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm check:expo
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e   # 本机缺少 Playwright headless shell 时加 PLAYWRIGHT_CHANNEL=chrome
```

开发启动脚本已建立，但依赖数据库/Redis 的业务尚未实现：

```bash
corepack pnpm dev:web
corepack pnpm dev:api
corepack pnpm dev:worker
corepack pnpm dev:mobile
```

本地基础设施：

```bash
cp .env.example .env
corepack pnpm infra:up
corepack pnpm infra:verify
corepack pnpm infra:status
corepack pnpm infra:down
corepack pnpm infra:reset   # 删除本地卷，开发数据丢失
```

`dev:web` 默认 127.0.0.1:3000，`dev:api` 默认 127.0.0.1:3001，Worker 管理探针默认 127.0.0.1:3002。Expo 需先设置设备可达的 `EXPO_PUBLIC_API_URL`，不能使用开发机 localhost。PostgreSQL 默认映射 127.0.0.1:55432（本机 5432 已被占用），Redis 默认 127.0.0.1:6379。数据库迁移、seed 与 API/Worker 连接池在 M0-05/M0-06 实际验证后补充。

## 协作方式

- 项目初期直接推送到 `main`，不强制创建 PR；需要审查、多人协作或高风险变更时再开分支 + PR。
- 每个提交是一个可审查、可验证的单位；后续 CI 覆盖 push 与 PR，不让直接推送绕过检查。
- 不提交真实密钥、私人数据或本地环境文件。
- 未实现的检查不能标为通过；Mock 和开发数据必须明确标识。
- 详细规则见 [AGENTS.md](AGENTS.md)。
