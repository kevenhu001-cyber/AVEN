# M0-02 / M0-03 工程骨架交付记录

日期：2026-11-10 · 状态：M0-02 已完成；M0-03 骨架与构建已完成，真机/原生流式验证未完成

## 范围与限制

本轮建立 pnpm/Turbo workspace、strict TypeScript、lint/依赖边界、四应用最小骨架和必要共享包。Web/Expo 仅提供明确标识的工程诊断页，不属于核心产品 UI，不替代 M1-07 设计评审。API/Worker 只提供存活探针；数据库/Redis/迁移与消费器未就位时，就绪探针返回 503，不能伪装业务可用。

Expo 的 Android JS 导出只是 Metro 编译验证，不是 APK、development build 或 Expo Go 真机验证。当前环境没有 Android SDK/adb，也没有连接设备，因此 M0-03 的真机连接与原生流式探针仍未执行，不能据此关闭 M0-03。纯传输测试只验证分块解析/取消，不代表已有 Agent/SSE 业务接口。

## 版本依据（实施前查询）

- [Next 安装要求](https://nextjs.org/docs/app/getting-started/installation)：Node ≥20.9，锁定 Next 16.4.6。
- [Expo SDK 矩阵](https://docs.expo.dev/versions/latest/)：SDK 58 对应 RN 0.88 / React 19.3；官方 expo-template-default 58.0.32 使用 Expo 58.0.23、RN 0.88.1、React/React DOM 19.3.0。
- [Expo Monorepo](https://docs.expo.dev/guides/monorepos/)：SDK 54 起支持 pnpm isolated 安装，不提前增加自定义 Metro 解析补丁。
- [Nest 首步](https://docs.nestjs.com/first-steps) 与 @nestjs/core 12.4.2 包元数据：Node ≥20。
- npm Registry 的精确版本/engines/peerDependencies 已查询：pnpm 12.18.0、Turbo 2.11.10、Zod 4.6.7；typescript-eslint 8.72.2 支持 TypeScript `>=4.8.4 <6.1.0`。Expo SDK 58 的 `expo install --check` 要求 TypeScript ~6.0.3 与 @babel/core ^7.29.7，故最终锁定 TypeScript 6.0.3，而不是 5.9.3 或尚未获支持的 TS 7。
- 运行机 Node 24.19.0、4 核、3.6 GiB 内存；构建与 Metro 限制并发。Corepack 已激活 pnpm 12.18.0。

精确清单最终以各 package.json 与 pnpm-lock.yaml 为准。

## 验证记录

以下命令于 2026-11-10 在本机实际执行，工作目录为仓库根目录：

| 命令 | 结果 |
|---|---|
| `corepack pnpm install --frozen-lockfile` | 通过；lockfile 与 workspace 一致，9 个 workspace 项目 |
| `corepack pnpm format:check` | 通过；Prettier 检查全部文件 |
| `corepack pnpm lint` | 通过；ESLint 0 warning，dependency-cruiser 无违规（27 modules / 34 dependencies） |
| `corepack pnpm check:expo` | 通过；`expo install --check` 报告依赖与 SDK 58 匹配 |
| `corepack pnpm typecheck` | 通过；Turbo 12/12 tasks，含 Next route typegen 与 Expo `tsc --noEmit` |
| `corepack pnpm test` | 通过；7 个测试文件、40 个测试，覆盖契约、环境解析、日志、API/Worker 真实 HTTP 探针与 SSE 传输解析 |
| `corepack pnpm build` | 通过；Turbo 8/8 tasks；Next 16.4.6 生产构建、API/Worker `tsc`、Expo Android JS 导出（Hermes bundle 约 3.6 MB） |
| `PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e` | 通过；6/6，桌面与 Pixel 7 视口，验证 Web 同源代理、503 就绪失败与无横向溢出 |

本机 Playwright 缓存缺少 `chromium_headless_shell-1254`，因此本地使用系统 Chrome（`PLAYWRIGHT_CHANNEL=chrome`）。CI 使用 `pnpm exec playwright install --with-deps chromium` 安装固定 Chromium，不使用该环境变量。

## 未实现与未验证

- Expo Go 真机连接、原生 SSE/取消探针、development build/APK：无 Android SDK/adb 与设备，未执行。
- 数据库/Redis/迁移/RLS/业务 API、BullMQ 消费与 Outbox、真实或 Mock AI Provider、生产部署、核心产品 UI。
- 候选部署地域与校园网络结果仍待真实环境调查，不以当前开发机网络替代。
- M0-03 只能记录为骨架与构建完成，不能标记 DONE；M0 整体验收仍未通过。
