# AVEN

AVEN 是面向个人与组织的 AI 连接网络，首个试点场景为西安交通大学。产品围绕个人上下文、组织资源、经授权的机会匹配，以及真实合作与活动协调展开。

## 安全核对进展

2026-11-11 核对发现，原忙闲投影允许已登录用户查询其他主体，缺少用途授权。修复分两步：迁移 `0027_availability_privacy` 先把查询收紧为仅本人（fail closed）；迁移 `0029_availability_sharing` 补上显式用途授权——忙闲所有者创建带期限（最长 90 天）的共享授权（用途 `event_coordination`），被授权方可读取忙闲投影，撤销后立即阻断。授权是单向的，不共享标题与备注等私人字段。决策见 [ADR-010](docs/architecture/decisions/0010-availability-authorization.md)。

新迁移必须应用到对应数据库后才生效，未迁移的运行环境仍有风险。本机已应用 `0027`–`0029` 并复验：`m6:verify` 30/30、`db:verify` 184 项、`m5:verify` 21/21、`isolation:verify` 21/21 全部通过。

M4–M6 的实现与执行记录不等于双端设计评审、真实 Provider、设备验收或 MVP 已完成。请同时查阅[开发计划](docs/development/DEVELOPMENT_PLAN.md)与 [M4](docs/development/M4_ORGANIZATION.md)、[M5](docs/development/M5_MATCHING_RELATIONSHIP.md)、[M6](docs/development/M6_CALENDAR_EVENT.md) 交付记录。

## AI 配置进展

用户希望自行配置 AI 服务。当前已增加用户级模型配置管理 API，密钥加密保存、读取不返回密钥，支持按版本更新与删除；用户设置尚未接入 Worker，界面也未实现，因此不能用于用户自配模型对话。服务端使用显式 HTTPS 地址允许列表；调用前仍需连接时网络安全检查、发送范围确认和真实服务验证。流式适配器已修正提前断流误报成功及估算 token 总量的问题，相关验证使用本地模拟响应。

## 当前状态

后端业务闭环已推进到 **M6 日程与活动**。已实现并通过真实 HTTP/数据库验证：

- **M0 工程基础**：workspace、Compose/PostgreSQL/Redis、迁移与 seed、就绪探针、Outbox/BullMQ、CI 工作流（**尚未在 GitHub Actions 实跑**）。
- **M1 设计**：仅令牌层（M1-01）与可点击原型（M1-07，**正式双端评审未做**）；M1-02–M1-06 组件与页面状态层未编码。
- **M2 身份与组织**：认证会话、资料/校园、组织成员与邀请、强制 RLS、跨账号/跨组织隔离。
- **M3 个人上下文与 AI**：记忆、复核、生命周期、Provider 与工具、Agent 运行时/SSE、行动确认；M3-07 只有评估集与预算门，**个人页面 UI 仍受 M1-07 评审门阻塞**。
- **M4 组织与机会**：组织资料、机会生命周期、组织控制台页面、组织 Agent 与边界测试。
- **M5 匹配·引荐·关系**：意向与可解释候选、用途授权预览、引荐双向决定、原子建联、关系共享上下文、撤销即时阻断；**M5-02 的向量语义召回未实现**（当前为确定性特征打分），**M5-08 Android 主线未实现**。
- **M6 日程与活动**：忙闲块、忙闲投影与用途授权共享、多方时间求交、活动状态机；**M6-05 AI 协调与 M6-06 通知投递未实现**，外部日历仅有数据底座（无 OAuth 连接器）。

尚未完成：个人与移动端 UI（`apps/mobile` 仅有骨架）、M7 运行保障与试点、真实 Provider/邮件/日历的真实服务验证、原生真机验收、双端设计评审、语义向量召回、通知投递。M0 与 MVP 均未完成。

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
| [迁移与开发数据](docs/development/MIGRATIONS.md) | 迁移 runner、D1 表、RLS 读策略、seed 与验证记录 |
| [服务可用性](docs/development/READINESS.md) | 存活/就绪探针、依赖失败语义与真实进程验证 |
| [异步可靠性](docs/development/ASYNC.md) | Outbox、BullMQ 消费、回执、重试、死信与故障注入 |
| [开发环境启动](docs/development/SETUP.md) | 首次启动、日常命令、故障处理与 CI 说明 |
| [部署与网络初查](docs/development/DEPLOYMENT_INVESTIGATION.md) | 候选地域、预算驱动项、校园/移动网络检查清单 |
| [M1-01 设计令牌](docs/development/M1-01_TOKENS.md) | 语义/状态色、排版、断点、减少动态与对比度验证 |
| [M1-07 设计评审](docs/design/M1-07_REVIEW.md) | 核心旅程可点击原型、状态矩阵、自检证据与未决问题 |
| [认证与会话 API](docs/api/AUTH.md) | 注册、登录、会话、CSRF、验证与密码重置契约 |
| [个人资料与校园 API](docs/api/PROFILE.md) | 资料更新、校园列表与校园成员申请契约 |
| [组织成员与邀请 API](docs/api/ORGANIZATIONS.md) | 组织创建、成员、邀请/接受、角色与离开契约 |
| [M2-01 认证交付](docs/development/M2-01_AUTH.md) | Argon2id、不透明会话、限流、数据库函数与验证记录 |
| [M2-02 资料与校园交付](docs/development/M2-02_PROFILE.md) | 资料更新、校园成员申请、函数边界与验证记录 |
| [M2-03 组织成员交付](docs/development/M2-03_ORGANIZATIONS.md) | 组织创建、邀请/接受、角色、最后 owner 保护与验证记录 |
| [M2-04 强制 RLS](docs/development/M2-04_RLS.md) | 18 张表 FORCE RLS、迁移角色例外与验证 |
| [M2-05 隔离验证](docs/development/M2-05_ISOLATION.md) | 跨账号/跨组织、伪造头、成员移除与连接池上下文 |
| [个人记忆 API](docs/api/MEMORIES.md) | 手工确认记忆、候选复核、事件审计、生命周期、来源、字段策略与软删除契约 |
| [M3-01 记忆交付](docs/development/M3-01_MEMORY.md) | 记忆表/函数、RLS、版本冲突与验证记录 |
| [M3-02 记忆复核交付](docs/development/M3-02_MEMORY_REVIEW.md) | 候选提取、确认/修改/拒绝、用途检索门与验证记录 |
| [M3-03 记忆生命周期交付](docs/development/M3-03_MEMORY_LIFECYCLE.md) | 事件审计、到期失效、软删除保留与审计保留清理 |
| [M3-04 Provider 与工具交付](docs/development/M3-04_AI_CORE.md) | Provider 抽象、Mock、工具权限/超时/重试/审计与验证记录 |
| [M3-05 运行时与流式交付](docs/development/M3-05_AGENT_RUNTIME.md) | Agent turn、持久事件、SSE 重放、取消、来源复核与 24 小时清理 |
| [M3-06 行动确认交付](docs/development/M3-06_ACTIONS.md) | 行动草稿、预览、一次性 token、幂等执行与取消 |
| [M3-07 评估与预算门](docs/development/M3-07_EVALUATION.md) | 脱敏评估集、来源支持/越权阻断/注入/结构化输出/取消、延迟与 token/工具预算、阈值与报告 |
| [M4 组织与机会交付](docs/development/M4_ORGANIZATION.md) | 组织资料、机会生命周期、组织控制台、组织 Agent 与边界测试 |
| [M5 匹配与关系交付](docs/development/M5_MATCHING_RELATIONSHIP.md) | 意向、候选、授权预览、引荐双向决定、原子建联、共享上下文与撤销传播 |
| [M6 日程与活动交付](docs/development/M6_CALENDAR_EVENT.md) | 忙闲块、忙闲投影与用途授权共享、多方求交、活动状态机 |
| [匹配候选 API](docs/api/MATCHING.md) | 意向状态机、候选生成、可解释评分与权限边界 |
| [引荐与授权 API](docs/api/REFERRALS.md) | 授权预览、引荐状态机、双向决定、共享快照与撤销 |
| [关系空间 API](docs/api/RELATIONSHIPS.md) | 关系建立、共享上下文、关闭与唯一性 |
| [日程与活动 API](docs/api/AVAILABILITY_EVENTS.md) | 忙闲块、忙闲投影、共享授权、多方求交与活动状态机 |
| [Agent 运行时 API](docs/api/AGENT.md) | turn 创建、run 状态、SSE 事件流、取消与保留契约 |
| [行动确认 API](docs/api/ACTIONS.md) | 草稿、预览、确认、取消、token 与幂等契约 |
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

下一项是 **M1-07 正式双端设计评审**，通过后才能进入个人页面与 M1-02/M1-03 组件层的 UI 编码；在此之前可以推进的工程项是 M6-06 通知投递、语义召回的 pgvector 迁移与真实 Provider 评估。真实 Provider 评估、M0-03 的 Expo Go 真机连接与 M0-08 的 GitHub Actions 实跑仍待环境；CI 工作流已定义、本地命令已通过，但不能宣称 CI 已绿。

契约见 [认证与会话 API](docs/api/AUTH.md)、[个人资料与校园 API](docs/api/PROFILE.md)、[组织成员与邀请 API](docs/api/ORGANIZATIONS.md)、[个人记忆 API](docs/api/MEMORIES.md)、[组织机会 API](docs/api/OPPORTUNITIES.md)、[匹配候选 API](docs/api/MATCHING.md)、[引荐与授权 API](docs/api/REFERRALS.md)、[关系空间 API](docs/api/RELATIONSHIPS.md)、[日程与活动 API](docs/api/AVAILABILITY_EVENTS.md)、[Agent 运行时 API](docs/api/AGENT.md)、[行动确认 API](docs/api/ACTIONS.md)。实现记录见 [M2-01](docs/development/M2-01_AUTH.md)、[M2-02](docs/development/M2-02_PROFILE.md)、[M2-03](docs/development/M2-03_ORGANIZATIONS.md)、[M2-04](docs/development/M2-04_RLS.md)、[M2-05](docs/development/M2-05_ISOLATION.md)、[M3-01](docs/development/M3-01_MEMORY.md)、[M3-02](docs/development/M3-02_MEMORY_REVIEW.md)、[M3-03](docs/development/M3-03_MEMORY_LIFECYCLE.md)、[M3-04](docs/development/M3-04_AI_CORE.md)、[M3-05](docs/development/M3-05_AGENT_RUNTIME.md)、[M3-06](docs/development/M3-06_ACTIONS.md)、[M3-07](docs/development/M3-07_EVALUATION.md)、[M4](docs/development/M4_ORGANIZATION.md)、[M5](docs/development/M5_MATCHING_RELATIONSHIP.md)、[M6](docs/development/M6_CALENDAR_EVENT.md)。原型入口：[M1-07 可点击原型](docs/design/prototypes/m1-07/index.html)；评审记录见 [M1-07 设计评审](docs/design/M1-07_REVIEW.md)。首次启动、日常命令与故障处理见 [开发环境启动](docs/development/SETUP.md)。开始前请阅读 [AGENTS.md](AGENTS.md) 和 [TDD](docs/architecture/TDD.md)。

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

Next 16.4.6、Nest 12.4.2、Expo SDK 58 与 Node 24.19.0 的最小安装、类型检查和生产构建已实际通过；PostgreSQL/Redis 启动、角色隔离、D1 空库迁移、已有库升级、seed 幂等与 RLS 读策略已实际验证；API 就绪 200、Redis 故障 503、Worker 消费者运行时就绪 200 已通过真实进程验证；Outbox/BullMQ 的成功、重复投递、未知结果、死信、租约、崩溃与 Redis 重启恢复已通过 29 项验证；单元测试已通过 **140 项**（2026-11-11）；认证与会话 42 项、资料/校园 16 项、组织成员 31 项、个人记忆 97 项真实检查、AI Provider/工具 28 项检查、Agent 运行时 45 项检查、行动确认 33 项检查通过；**机会 34 项、组织边界 25 项、首条闭环 21 项（M5）、日程与活动 30 项（M6）** 通过；**数据库层 184 项检查通过**（29 个迁移、45 张业务表，全部 FORCE RLS），强制 RLS/隔离 63 项数据库检查与 21 项隔离检查通过；M3-07 评估 10/10 用例（含结构化输出与取消）、阈值与预算检查通过。数据库扩展镜像、真机连接、生产队列运维、真实邮件、GitHub Actions 实跑与双端高保真尚未验证；CI 工作流与本地命令已就绪，不能宣称 CI 已绿。

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
corepack pnpm check:readiness   # 需要 Compose 依赖与已构建 API/Worker
corepack pnpm async:verify      # Outbox/BullMQ 故障注入，会短暂停止 Redis
corepack pnpm auth:verify       # 认证/会话真实 HTTP 检查，需要 Compose 依赖
corepack pnpm profile:verify    # 资料/校园成员真实 HTTP 检查
corepack pnpm organization:verify # 组织成员/邀请真实 HTTP 检查
corepack pnpm isolation:verify  # 跨账号/跨组织与连接池隔离检查
corepack pnpm memory:verify     # 个人记忆 M3-01/M3-02/M3-03 创建/复核/审计/失效/保留检查
corepack pnpm memory:maintain   # 到期失效、正文保留清理与审计事件保留清理
corepack pnpm ai:verify         # Mock/OpenAI-compatible Provider 与工具权限/超时/重试/审计检查
corepack pnpm ai:eval           # 脱敏评估集、来源支持/越权阻断/注入与预算阈值检查，报告写入 var/eval
corepack pnpm agent:verify      # Agent turn/SSE 重放/取消/来源复核/过期清理检查
corepack pnpm agent:maintain    # Agent 事件 24 小时保留清理
corepack pnpm action:verify     # 行动草稿/预览/token/确认/幂等/取消/过期检查
corepack pnpm opportunity:verify # 机会草稿/发布/暂停/关闭/可见性/过期检查
corepack pnpm opportunity:maintain # 机会到期与状态维护任务
corepack pnpm org:verify        # 组织边界、成员移除与旧草稿确认阻断检查
corepack pnpm m5:verify         # 首条闭环：意向→候选→授权→引荐→建联→撤销阻断
corepack pnpm m6:verify         # 忙闲、忙闲共享授权、多方求交与活动状态机
```

开发启动脚本已建立；认证、资料/校园、组织、记忆、Agent、行动确认、机会、意向/匹配、引荐/授权、关系、忙闲与活动 API 已实现；真实 AI Provider 与核心产品页面（个人与移动端）尚未实现：

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

数据库迁移与开发数据：

```bash
corepack pnpm db:status
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm db:verify        # 重建 aven_test，验证空库迁移/升级/seed/RLS
corepack pnpm db:verify:current
```

`dev:web` 默认 127.0.0.1:3000，`dev:api` 默认 127.0.0.1:3001，Worker 管理探针默认 127.0.0.1:3002。Expo 需先设置设备可达的 `EXPO_PUBLIC_API_URL`，不能使用开发机 localhost。PostgreSQL 默认映射 127.0.0.1:55432（本机 5432 已被占用），Redis 默认 127.0.0.1:6379。当前迁移覆盖 D1 身份/组织、异步样例、个人记忆/复核/生命周期、Agent 运行时与行动确认表、机会/组织 Agent、意向与匹配、授权与引荐、关系与共享、日程/忙闲/活动、忙闲隐私与共享授权、用户级 AI Provider 配置；API 就绪检查数据库、Redis 与迁移版本，Worker 运行 Outbox、样例与 Agent 消费者。完整启动、故障处理与 CI 说明见 [开发环境启动](docs/development/SETUP.md)。

## 协作方式

- 项目初期直接推送到 `main`，不强制创建 PR；需要审查、多人协作或高风险变更时再开分支 + PR。
- 每个提交是一个可审查、可验证的单位；后续 CI 覆盖 push 与 PR，不让直接推送绕过检查。
- 不提交真实密钥、私人数据或本地环境文件。
- 未实现的检查不能标为通过；Mock 和开发数据必须明确标识。
- 详细规则见 [AGENTS.md](AGENTS.md)。
