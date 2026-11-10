# AVEN

AVEN 是面向个人与组织的 AI 连接网络，首个试点场景为西安交通大学。产品围绕个人上下文、组织资源、经授权的机会匹配，以及真实合作与活动协调展开。

## 当前状态

项目处于开发规划阶段，尚无可运行的应用代码。当前提交包含原始产品规格、详细开发计划和仓库基础配置；不代表 M0 或 MVP 已经完成。

原始规格使用 PAN（Personal AI Network）作为代号。仓库及后续工程文档使用 AVEN，原始文档保留原文供追溯。

## 文档

- [详细开发计划](docs/development/DEVELOPMENT_PLAN.md)：阶段任务、依赖、接口与数据设计要求、测试及验收标准。
- [开发启动建议](docs/development/START_HERE.md)：首次工作区评估与启动思路，后续安排以详细计划为准。
- [原始产品与工程规格](Origin%20Plan.md)：产品范围、设计系统、技术方向和完整 MVP 要求。

## 首条交付主线

组织发布机会 → 个人发现机会 → 预览并授权共享资料 → 双方确认 → 建立关系空间 → 撤销授权后停止相关访问。

该主线是首个业务验收目标；完整 MVP 还包含个人与组织 AI、记忆管理、Android、日程协调和运行保障。

## 技术方向

| 范围 | 计划采用 |
|---|---|
| 工程 | TypeScript、pnpm、Turborepo |
| Web | Next.js App Router、Tailwind CSS、shadcn/ui、Lucide |
| 原生移动端 | Expo、React Native、Expo Router |
| 后端 | NestJS 模块化单体、REST、SSE |
| 数据与任务 | PostgreSQL、Drizzle、pgvector、PostGIS、Redis、BullMQ |
| AI | 可替换 Provider、工作流运行时、显式行动确认 |
| 验证 | Zod、Vitest、Playwright、Maestro |

具体版本、身份提供方和部署环境在 M0 中验证并记录，不在规划阶段假定兼容性。

## 开发入口

从开发计划中的 **M0-01** 开始，先完成最小工程文档与依赖决策，再建立运行骨架。后续补充的 `AGENTS.md`、PRD、设计系统、TDD 和数据库文档须在对应代码实施前建立并阅读。

截至 2026-11-10，工作区可调用 Git、Node 和 pnpm，未找到 Docker 命令。尚未验证数据库、Redis、Android 开发环境及应用依赖兼容性。

当前没有 `pnpm dev` 等可执行项目脚本；M0 验收时需提供经过实际验证的安装、迁移、启动和测试步骤。
