# ADR-001：运行时与工具链

- 状态：提议（M0-02 验证后转为已接受）
- 日期：2026-11-10
- 相关：[TDD](../TDD.md) · [DEVELOPMENT_PLAN](../../development/DEVELOPMENT_PLAN.md)

## 背景

原计划记录本机为 Node v26.13.0、pnpm 12.16.1，但 2026-11-10 实际检测为：

- Node v24.19.0
- npm 11.17.0
- pnpm 未安装，corepack 0.35.0 可用
- Docker 29.1.3 可用
- PostgreSQL 客户端 16.14，Redis 未安装
- 4 核 CPU、3.6 GB 内存、17 GB 可用磁盘
- 无 Android SDK/adb

不能根据本机版本推断框架兼容性，也不能把未验证的组合写成已完成。

## 决策

1. 运行时使用 **Node 24 LTS**（以官方当前 LTS 为准），通过 `.nvmrc`/`.node-version` 和 CI 固定。
2. 包管理器使用 **pnpm**，通过 corepack 启用并锁定 `packageManager` 版本；提交 `pnpm-lock.yaml`。
3. Monorepo 使用 **Turborepo**；TypeScript 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`（按框架兼容性调整）。
4. 框架基线：Next.js App Router、React、NestJS、Expo、Drizzle、Zod、Vitest、Playwright。具体版本在 M0-02 查官方兼容要求后锁定，不使用浮动 `latest`。
5. 先建立最小构建和类型检查，再添加应用；不一次性生成全部空模块。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Node 26 + pnpm 最新 | 版本新 | 生态兼容未验证，本机也没有 | 不采用 |
| npm workspaces | 无需安装 pnpm | 与计划不一致，磁盘/依赖管理较弱 | 不采用 |
| Yarn PnP | 依赖严格 | 工具链和原生包兼容风险 | 不采用 |
| 直接使用最新 TypeScript 7 | 新特性 | 框架/插件兼容未知 | 验证后再定 |

## 后果

- 需要先安装 pnpm 并验证 Node 24 与 Next/Nest/Expo 的兼容性。
- CI 必须使用与本地相同的 Node/pnpm 版本。
- 版本升级需要单独 PR，并记录兼容性验证。
- 本机内存偏紧，开发时按需启动应用，不默认同时跑全部服务。

## 验证

- [ ] `corepack enable` 后 `pnpm -v` 可用。
- [ ] 最小 workspace 安装成功，lockfile 生成。
- [ ] TypeScript strict 类型检查通过。
- [ ] Next/Nest/Expo 最小构建通过。
- [ ] 记录实际版本、命令和失败项到 M0-02 交付说明。
