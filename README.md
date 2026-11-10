# AVEN

AVEN 是面向个人与组织的 AI 连接网络，首个试点场景为西安交通大学。产品围绕个人上下文、组织资源、经授权的机会匹配，以及真实合作与活动协调展开。

## 当前状态

项目处于 **M0 基础工程**阶段。已完成 **M0-01：最小产品与工程文档**；尚无应用代码、依赖清单、数据库迁移、CI 或可运行脚本。本文档集不代表 M0 或 MVP 已完成。

原始规格使用 PAN（Personal AI Network）作为代号。仓库及后续工程文档使用 AVEN，原始文档保留原文供追溯。

## 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent/开发者必读规则、目录边界、安全与交付要求 |
| [PRD](docs/product/PRD.md) | 产品范围、首条旅程、可见性、页面与 MVP DoD 映射 |
| [设计系统](docs/design/DESIGN_SYSTEM.md) | 令牌、布局、组件、页面状态、无障碍 |
| [TDD](docs/architecture/TDD.md) | 模块边界、身份、授权、状态机、事务、异步、API 与测试 |
| [SCHEMA](docs/database/SCHEMA.md) | 首批表、约束、索引、RLS、迁移与数据保留 |
| [API 契约](docs/api/README.md) | 端点级请求/响应模板与首批端点清单（随实现补充） |
| [ADR](docs/architecture/decisions/) | 运行时、身份、数据运行、RLS、Outbox、AI Provider 决策 |
| [详细开发计划](docs/development/DEVELOPMENT_PLAN.md) | 阶段任务、依赖、接口与验收标准 |
| [开发启动建议](docs/development/START_HERE.md) | 首次工作区评估与启动思路 |
| [原始产品与工程规格](Origin%20Plan.md) | 产品范围、设计系统、技术方向和完整 MVP 要求 |

## 首条交付主线

组织发布机会 → 个人发现机会 → 预览并授权共享资料 → 双方确认 → 建立关系空间 → 撤销授权后停止相关访问。

该主线是首个业务验收目标；完整 MVP 还包含个人与组织 AI、记忆管理、Android、日程协调和运行保障。

## 技术方向

| 范围 | 计划采用 |
|---|---|
| 工程 | TypeScript strict、pnpm、Turborepo、Node 24 LTS（待 M0-02 验证） |
| Web | Next.js App Router、Tailwind CSS、shadcn/ui、Lucide |
| 原生移动端 | Expo、React Native、Expo Router；开发期真机 Expo Go |
| 后端 | NestJS 模块化单体、REST、SSE |
| 数据与任务 | PostgreSQL、Drizzle、pgvector、PostGIS、Redis、BullMQ |
| 身份 | 自建邮箱 + 密码、Argon2id、不透明会话、RLS |
| AI | 可替换 Provider、默认 Mock、OpenAI-compatible 适配器、显式行动确认 |
| 验证 | Zod、Vitest、Playwright、Maestro |

具体版本、部署环境和真实 AI Provider 在对应阶段验证并记录，不在规划阶段假定兼容性。

## 开发入口

下一项任务是 **M0-02：依赖与运行时**，完成 ADR-001 验证、锁定版本、建立 workspace 与 strict TypeScript/lint；随后 M0-03 建立 Web/API/Worker/Expo 最小骨架。

开始前请阅读 [AGENTS.md](AGENTS.md) 和 [TDD](docs/architecture/TDD.md)。M0-01 建立的 `PRD`、`DESIGN_SYSTEM`、`TDD`、`SCHEMA` 已就位，代码实施前必须阅读对应章节。

## 环境现状

截至 2026-11-10 实际检测：

| 项 | 状态 |
|---|---|
| Node | v24.19.0 |
| npm | 11.17.0 |
| pnpm | 未安装；corepack 0.35.0 可用 |
| Docker | 29.1.3，可用 |
| PostgreSQL 客户端 | 16.14 |
| Redis | 未安装；计划用 Docker |
| Android SDK/adb | 未安装；开发期用真机 Expo Go |
| 资源 | 4 核 / 3.6 GB 内存 / 17 GB 可用磁盘 |

尚未验证 Node 24 与 Next/Nest/Expo 的兼容性，也未验证数据库扩展镜像。M0-02/M0-04 必须实际验证并更新本文。

## 开发命令

当前没有 `pnpm dev`、`pnpm test` 或数据库迁移脚本。M0-02/M0-03 完成并实际执行后，在此补充经过验证的安装、迁移、启动和测试命令。

## 协作方式

- 默认从 `main` 建分支，通过 PR 合并；每个 PR 是一个可审查、可验证的单位。
- 不提交真实密钥、私人数据或本地环境文件。
- 未实现的检查不能标为通过；Mock 和开发数据必须明确标识。
- 详细规则见 [AGENTS.md](AGENTS.md)。
