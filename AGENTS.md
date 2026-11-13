# AGENTS.md — AVEN 工程协作规则

本文件适用于所有在本仓库工作的 AI Agent 和人类开发者。开始修改代码前必须阅读。

## 1. 当前阶段

- 2026-11-13 用户进一步要求自配渠道页，按 ADR-020 实现个人模型配置、连接测试及按配置身份/版本绑定的 Worker 选择。只外发当前提问与获准上下文，组织与旧 Mock 不升级；APK 保持暂停。

- 2026-11-13 用户明确授权按 ADR-019 接入个人聊天真实模型，沿用 Socrates 当前内置模型配置，仅发送当前提问及已获授权上下文。此授权替代下方个人聊天真实 Provider 暂缓限制；不授权组织外发、真实连接器/OAuth 或 APK 构建。真实成功以实际验证为准。

- 2026-11-13 用户明确要求全面梳理与开发 Web 和 Android，按 ADR-018 开始双端个人工作区实施，替代下方历史 Android 暂缓与本轮个人界面编码顺序限制。正式设计评审、真实 Provider/OAuth、生产试点与原生发布验收仍须独立证据，不因实施授权而标为完成。

- WEB-01 个人 Web 已按 ADR-017 限定接入注册/登录、Mock SSE、手工记忆、连接邀请/消息与站内通知。首页为开发验证版，工程诊断迁至 `/diagnostics`。最新范围和实际证据以 `docs/development/WEB_PERSONAL.md` 为准；下方历史“无 UI”仅限原交付阶段。M1-07 整体仍 REVIEW，不授权真实 Provider、外部 OAuth 或 Android。

- 2026-11-13 用户明确授权开始下一阶段：按 [ADR-017](docs/architecture/decisions/0017-personal-web-increment.md) 实施个人 Web 限定主线。该范围可进入 UI 编码，M1-07 整体仍为 REVIEW，其他页面/原生/真实 Provider/试点门不变；以下历史“不能进入 UI 编码”在本轮限定范围内按此授权执行。

- 2026-11-13 **WEB-03 连接器与会话小组件**已交付：个人 Web 对话输入区新增连接器入口，按类别展示服务端目录的 11 个内置连接器与凭据状态，按动作生成表单并以 Mock 模式调用，结果以 12 种声明式小组件卡片渲染进对话流，外部跳转需二次确认。新增 Web 端纯函数单测（vitest 范围扩到 `apps/web/src`）。未接入真实开放平台凭据、真实 MCP 传输或第三方账号。详见 `docs/development/WEB_03.md`。

- 2026-11-13 **WEB-02 候选记忆复核与通知偏好**已交付：个人 Web「记忆与上下文」新增候选复核标签页（服务端规则提取 `mock_rules_v1`、逐条编辑/确认/拒绝、用途默认拒绝），已确认信息可原位编辑与二次确认撤回，通知面板新增通知偏好开关（`expectedVersion` 乐观锁、冲突回读）。共享客户端新增记忆复核方法并首次支持 `PATCH`。无迁移、无服务端改动，未接入真实 Provider/OAuth/原生端；单测 308 项、个人 Web 复验 12 项、WEB-01 回归 18 项、恢复 7 项通过。详见 `docs/development/WEB_02.md`。

- 2026-11-12 **M5-04 引荐补充资料、内容版本化与超期维护**已交付：0038、`referral_supplements` 表（FORCE RLS）、`content_version` 递增、组织待审自动重置、Worker 批量超期维护存储过程 `app.maintain_referrals`、API 客户端与 NestJS 控制器端点、`supplements:verify` 25 项全通过。当前 38 个迁移、61 张租户表（58 张 public + 3 张 app），全部 FORCE RLS。单测 235 项全通过。详见 `docs/development/REFERRAL_SUPPLEMENTS.md`。至此 M5-04 闭环为 DONE。

- 2026-11-12 **P2P-04 个人连接会话消息与保留清理**已交付：0036、`peer_messages` 表（FORCE RLS）、时间倒序键集游标分页、单方软删除与双方软删除 Worker 物理清除、API 客户端与 NestJS 控制器端点、`messages:verify` 31 项全通过。产品聊天 UI、移动即时推送与自动调度仍未实现；M1-07 门不变。

- 2026-11-12 **M6-06A2 活动协调站内通知后端**已交付：0035、`event_coordination_events` FORCE RLS 表、同事务 Outbox、真实 BullMQ 队列消费、活动提案/确认/取消流转通知、用户偏好过滤（`eventInvitations`/`eventUpdates`）、`notifications:verify:events` 18 项全通过。加上此前 M6-06A1 个人连接站内通知，站内通知后端已闭环。详见 `docs/development/NOTIFICATIONS.md`。移动推送、通知 UI、生产调度/告警仍未实现；M6-06 为 PARTIAL，M1-07 门不变。

- 2026-11-12 **P2P-03 正文保留清理**已交付：0033、预览过期 24 小时/失效正文 30 天、固定保留窗与分批 Worker 函数、不可复活与元数据保留。开发/隔离库各 37 项清理检查、74 项连接 HTTP 检查、188 项单测和旧数据升级通过；详见 `docs/development/CONNECTION_RETENTION.md`。生产自动调度、全用途快照清理、审计保留和用户删除申请仍未完成。
- 最新整包状态以 `docs/development/SYSTEM_STATUS.md` 与开发计划本轮复核为准：M0-08、M4-03、M5-06、M6-02 为 PARTIAL，M5-09 为 REVIEW。M5-04 补充资料与维护已闭环（DONE）。下方历史交付仅按限定后端/工程范围理解，不代表 CI、正式 UI 或产品验收完成。


- 2026-11-12 新增 **P2P-02 共享连接客户端与小组件读取协议**：逐次 Web Cookie/CSRF 或移动 Bearer 认证、输入/响应校验、无正文缓存/自动重试、小组件当前会话角色与实时授权快照。71 项真实 HTTP/数据库检查、179 项单测通过；无新迁移。详见 `docs/development/CONNECTION_CLIENT_WIDGET.md`。尚无产品小组件、登录 UI、Agent 绑定、推送或真机验收；M1-07 设计门不变。

- 2026-11-12 新增 **P2P-01 个人连接邀请后端**：独立预览、记忆正文的 connection_invitation 用途授权、幂等发送、接收方决定、原子唯一建联、撤回/撤销和来源失效。该轮共 32 个迁移、49 张 public 表（另 3 张 app 租户表），全部 FORCE RLS；个人连接在隔离与开发库各通过 53 项 HTTP/数据库验证，详见 `docs/development/PERSONAL_CONNECTIONS.md`。个人连接不复用组织/机会关系，尚无 UI、发现、共同消息、通知、原生跨终端或真实模型接入；不能描述为完整社交应用。以下 M0–M6 记录保留各自范围。

- 已完成 **M0-01**、1.1 契约修订、**M0-02**、**M0-04**、**M0-05**、**M0-06**、**M0-07**、**M0-08 工作流定义（实跑待补）**、**M1-01：设计令牌与主题**、**M1-07 核心旅程可点击原型**（REVIEW）、**M2-01–M2-05：认证、组织与强制 RLS**、**M3-01–M3-06：记忆、复核、生命周期、Provider 与工具、Agent 运行时、行动确认**、**M3-07 评估部分**、**M4-01–M4-05：组织资料、机会生命周期、组织控制台、组织 Agent 与边界测试**、**M5-01–M5-07 与 M5-09：意向、候选、授权预览、引荐双向决定与补充资料、原子建联、共享上下文、撤销传播与首条闭环**、**M6-01–M6-04、M6-01R 与 M6-06A（站内通知后端：个人连接与活动协调）**、**P2P-01–P2P-04（个人连接邀请、共享客户端、正文保留与会话消息）**、**安全与试点准入后端（个人拉黑、违规举报、24h 邀请频控与双向阻断）**。正式双端设计评审待完成；**M0-03：应用与共享包**的骨架与构建已完成，Expo Go 真机连接与原生流式探针待设备环境补验。
- 尚未实现：**M1-02–M1-06 组件与页面状态层**（除 ADR-017 限定个人 Web 已接入部分）、**M3-07 个人页面与记忆复核 UI**（候选复核与编辑/撤回已按 ADR-017 限定接入；完整个人页面与设计评审仍受 M1-07 门阻塞）、**M5-02 向量语义召回**（当前为确定性特征打分）、**M5-08 Android 主线**、**M6-05 AI 协调**、**M6-06 移动推送与 UI**、**M6-02 真实外部日历连接**、**M7 运行保障与试点**、真实 Provider 验证。
- 已建立依赖清单、lockfile、公共配置、四应用最小骨架、CI 工作流、Compose/PostgreSQL/Redis、逐用途数据库角色、38 个迁移与强制 RLS（61 张租户表）、存活/就绪探针、Outbox/BullMQ 样例、故障验证、设计令牌、核心旅程原型、认证会话、资料/校园申请、组织成员、手工确认记忆、候选复核、生命周期审计/失效/保留、Provider/工具契约、Agent 运行时/SSE、行动确认与脱敏评估集/预算阈值、机会生命周期、组织控制台、意向与可解释候选、用途授权预览、引荐双向决定与补充资料、关系空间与共享上下文、忙闲与忙闲授权共享、多方求交、活动状态机、站内通知后端闭环、个人连接消息与保留清理、个人拉黑与举报治理闭环；核心产品 UI、真实模型、通知 UI/移动推送与真实日历仍未完成，具体以开发计划执行记录为准。
- 不要把规划、文档、脚手架、Mock 或开发数据描述为功能完成。
- 工程诊断页仅验证联通，不是产品核心 UI；M1-07 的双端设计门仍适用。
- 任何状态变更以实际代码、命令输出和验证结果为依据，并同步更新 README 和开发计划执行记录。

## 2. 必读顺序

修改代码前按顺序阅读：

1. `README.md`
2. `AGENTS.md`（本文件）
3. `docs/product/PRD.md`
4. `docs/design/DESIGN_SYSTEM.md`；涉及界面时另读 `docs/design/CORE_JOURNEY.md`
5. `docs/architecture/TDD.md`
6. `docs/database/SCHEMA.md`
7. `docs/api/` 中与任务相关的端点契约
8. `docs/architecture/decisions/` 中与任务相关的 ADR
9. 相关模块的现有代码、测试和迁移

不要在没有检查现有实现的情况下重新搭建项目。

## 3. 文档优先级

- `Origin Plan.md` 是原始需求来源，保留原文和 PAN 代号。
- `PRD`、`TDD`、`SCHEMA`、`DESIGN_SYSTEM` 是实现契约，统一使用 AVEN。
- 如果实现需要偏离契约，先更新文档并说明原因，再改代码；已接受 ADR 用新 ADR 取代，不能改写历史结论。当前授权以 ADR-007 为准，渐进交付以 ADR-008 为准。
- 发现文档/Schema/代码冲突先澄清，不以已有代码自动覆盖产品或安全规则；同一可审查变更同步修正。
- 文档中的“计划”“建议”“待验证”不等于已实现；不要据此宣称完成。

## 4. 目录与边界

| 路径 | 职责 | 禁止 |
|---|---|---|
| `apps/web` | 个人 Web 与组织控制台 | 直接连接数据库；复制业务后端 |
| `apps/mobile` | Expo 原生移动端 | WebView 包装 Web；直接连接数据库 |
| `apps/api` | NestJS HTTP 入口、鉴权、DTO、事务边界 | 控制器写复杂业务；直接拼 SQL |
| `apps/worker` | BullMQ/Outbox 消费者 | 复制 API Service；绕过权限 |
| `packages/contracts` | Zod Schema、DTO、事件、权限常量 | 依赖数据库/Nest/React |
| `packages/database` | Drizzle Schema、迁移、Repository | 被 Web/Mobile 直接依赖 |
| `packages/service-health` | API/Worker 共享的存活/就绪探针 | 存放业务逻辑；被 Web/Mobile 依赖 |
| `packages/domain` | 框架无关领域服务 | 依赖 Nest/HTTP/React |
| `packages/api-client` | HTTP/SSE 客户端 | 混入 UI 状态 |
| `packages/design-tokens` | 设计令牌 | 依赖应用代码 |
| `packages/ai-core` | Provider/工具契约与评估（M3） | 直接访问数据库 |
| `packages/ui-web` | 复用 Web 组件（M1） | 强制移动端复用 |
| `packages/config` | TS/lint/环境配置 | 存放业务逻辑 |
| `infra` | Compose、脚本、部署 | 存放业务迁移 |

依赖方向见 [TDD 第 4 节](docs/architecture/TDD.md#4-仓库结构与依赖规则)。禁止循环依赖。

## 5. 工程规则

- TypeScript strict；避免 `any`；边界输入必须用 Zod 校验。
- 使用统一错误结构和请求 ID；不泄露堆栈、SQL、密钥或私人上下文。
- 使用依赖注入；避免巨型组件和巨型 Service；保持模块边界。
- 所有数据库变更必须提供迁移；禁止手工改 schema 或使用 `drizzle-kit push` 上生产。
- 所有写操作考虑幂等；高影响操作支持 `Idempotency-Key`。
- 版本冲突不静默覆盖；使用乐观锁/唯一约束。
- 结构化日志；不记录密码、token、完整邮箱、私人正文、消息内容、提示词。
- 核心权限、状态转换、并发和失败路径必须有测试。
- 不为了架构复杂度引入不必要的技术；优先完成纵向业务闭环。

## 6. 安全规则

- 默认拒绝；服务端重新校验权限，不信任客户端传入的主体/组织 ID。
- 普通请求使用 `aven_app`，认证/Worker 分别使用受限角色；不授予全 schema DML，不用可写 worker/admin GUC 提权，函数所有者权限按 ADR-007 实测。
- 事务内安全绑定 actor；RLS 防遗漏过滤/身份串用，不是任意 SQL 执行下的独立身份凭据。
- 字段展示、发现与 self_ai/matching/sharing 用途独立；缺失策略默认拒绝。组织不能读取未发送候选。
- 授权读取在主库核对双方/当前代表权、用途、业务对象、grant/item/来源状态与期限；共享只读不可变授权快照。
- 引荐用途不升级为关系用途；预览绑定实际值、来源/策略版本、接收方和期限，变化后重新确认。
- 撤销提交后新授权检查拒绝；行锁不收回在途字节/已送达副本。幂等/SSE 重放、缓存与任务输出不能绕过当前授权。
- AI 工具必须有参数 Schema、权限、超时、重试、幂等和审计；不能直接 SQL/HTTP/文件系统。
- 开发身份只在显式开发环境启用，不能成为生产鉴权回退。
- 真实密钥只放环境变量/Secret Manager；`.env.example` 不含真实值。
- 发现越权、私人信息泄露、重复外部操作或迁移损坏时，暂停相关功能并补回归测试。

## 7. AI 规则

- 默认 Mock Provider；UI 明确标识；Mock 结果不能证明智能能力完成。
- 真实 Provider 通过统一接口接入；不把供应商写死。
- 只发送当前用途允许的字段；不发送完整私人记忆或对话历史。
- 高影响行动必须草稿 → 预览 → 用户确认 → 执行；确认绑定草稿版本和有效期。
- 流式输出区分文字生成、工具执行、等待确认、异步任务和失败。
- 工具参数伪造、Prompt Injection、越权检索必须有测试。

## 8. 测试与完成标准

每个工作包完成前：

- [ ] 行为满足约定范围，数据库/API/界面同步变更。
- [ ] 核心权限、输入输出、失败与重试路径实现并验证。
- [ ] 迁移、索引、约束、RLS 随表交付。
- [ ] lint、类型、测试、构建通过，保存实际命令和结果。
- [ ] 文档与实际命令一致；开发数据、Mock 和限制明确标识。
- [ ] 界面有双端设计评审、适用状态矩阵与实际行为证据；原型/截图不代替 E2E，Expo Go 不代替发布构建。
- [ ] 交付说明包含文件变化、架构、数据库、API、测试、已知问题和后续任务。

未执行的检查不能标为通过；不能用空脚本显示绿色。

## 9. Git 与提交

- 项目初期直接推送到 `main`，不强制创建 PR；需要审查、多人协作或高风险变更时再开分支 + PR。
- 需要分支时命名：`feat/...`、`fix/...`、`docs/...`、`chore/...`。
- 每个提交是一个可审查、可验证的单位；范围大时拆为契约、实现、界面，但不留下可误执行的半成品。
- 提交信息用英文，建议 `type(scope): summary`。
- 直接推送前必须自查：变更范围、敏感信息、链接、格式和实际执行的检查。
- 高风险或跨模块变更建议开 PR；PR 描述包含变更文件、架构影响、数据库/API 变化、测试命令与结果、已知问题、后续任务。
- 不在提交中放入真实密钥、私人数据、生成物或本地环境文件。
- CI 覆盖 push 与 PR；失败不能作为可发布版本，直接推送后需修复/回退。未实现的检查不能放空。
- 真实数据试点前关闭隐私告知、数据位置、邮件/校园网络、支持/删除流程与恢复演练，不等 M7 才首次调查。

## 10. 当前禁止

阶段门（M0-02/03 骨架、M0-04 基础设施、M0-05 迁移、M0-06 探针、M0-07 异步样例与 M0-08 CI 文档已建立；完成声明仍须证据）：

- 不声称双端高保真、设计评审或页面状态矩阵已完成；M1-01 只交付令牌层，M1-07 原型处于 REVIEW，不能进入 UI 编码门。
- 不把可点击原型、截图或样例数据当作组件实现、E2E、真机或业务验收。
- 不声称 CI 已通过；工作流已定义，但未在 GitHub Actions 实跑。
- 不声称完整身份、校园/组织权限、`FORCE RLS` 或业务 API 已完成；M2-01–M2-05 只交付认证、资料/校园申请、组织成员、强制 RLS 与隔离验证，生产身份系统仍未完成。
- 不声称组织所有权转让、认证审核或审计已完成；最后 owner 不能离开/移除，所有权转让尚未实现。
- 不声称个人记忆、记忆复核、生命周期、Agent 运行时、行动确认、机会、引荐、关系、忙闲、活动、真实 AI 或核心产品 UI 已完成；M3-01 只交付手工确认记忆，M3-02 只交付确定性 Mock 候选复核与用途检索门，M3-03 只交付事件审计、到期失效与保留清理，M3-04 只交付 Provider/工具契约与 Mock，M3-05 只交付 Mock Agent 运行时/SSE/取消/来源复核，M3-06 只交付 `memory.create` 行动确认框架，M3-07 只交付脱敏评估集、预算/阈值与 Mock 评估报告；真实 Provider、高影响业务行动、个人页面与评估模型能力仍未完成。
- 不声称首条业务闭环已验收；M5 只交付确定性闭环与撤销传播，**M5-02 向量语义召回未实现**（当前为确定性特征打分），M5-08 Android 主线未实现，关系会话 API 不存在。
- 不声称日程协调已完成；M6-01–M6-04 只交付忙闲、忙闲用途授权共享、多方求交与活动状态机，**M6-05 AI 协调未实现，M6-06 仅个人连接站内通知后端已交付**（活动通知、推送、UI 与运维仍未完成），M6-02 只有数据底座、没有真实外部日历 OAuth 连接器。
- 不把忙闲授权共享描述为时间窗粒度；当前共享按主体与期限授权，覆盖该主体全部忙闲块。
- 不声称生产邮件、MFA、账号锁定、空闲超时或真实设备会话生命周期已完成。
- 不声称业务队列、死信运维、指标或 exactly-once 已完成；M0-07 仅是工程样例，至少一次投递仍需业务幂等。
- 不修改已应用的迁移文件；修正必须新增迁移并重新验证空库/升级路径。
- 不声称 Web/API/Worker/Expo 已完成或可发布；当前仅通过最小构建与工程探针。
- 不把 Compose 启动、D1 只读策略、seed、探针或样例任务当作数据库层、RLS 或业务可用。
- 不接入真实 AI Provider（用户自配 Provider 配置接口已实现，但尚未接入 Worker 与界面，不能用于真实数据发送）。
- 不开始 Android 应用实现（当前无 Android SDK；M0-03 先验证 Expo Go 连接，M5 前建立 development build 主线）。
- 不把 Expo JS 导出、Web E2E 或截图当作原生真机/发布构建证据。

## 11. 语言与沟通

- 产品/工程文档用中文；代码、标识符、提交信息和 API 字段用英文。
- 中英文之间保留空格；专有名词大小写一致。
- 交付说明简洁、具体，区分“已完成”“已验证”“计划中”“未实现”。
- 遇到阻塞记录原因、影响和下一步，不把阻塞写成完成。

## 12. 常用命令

以下命令已在 M0-02/M0-03 实际执行并通过；未执行的检查不得标为通过：

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

开发启动：`corepack pnpm dev:web`、`dev:api`、`dev:worker`、`dev:mobile`。数据库迁移与 seed 命令在 M0-05 实际验证后补充，不要提前编造。

本地基础设施（M0-04 已验证）：

```bash
cp .env.example .env
corepack pnpm infra:up
corepack pnpm infra:verify
corepack pnpm infra:status
corepack pnpm infra:down
corepack pnpm infra:reset   # 删除本地卷
```

数据库迁移与开发数据（M0-05 已验证）：

```bash
corepack pnpm db:status
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm db:verify        # 重建 aven_test，验证空库/升级/seed/RLS
corepack pnpm db:verify:current
```

就绪检查（M0-06 已验证，需要 Compose 依赖与已构建 API/Worker）：

```bash
corepack pnpm build
corepack pnpm check:readiness
```

异步可靠性（M0-07 已验证，会短暂停止 Redis）：

```bash
corepack pnpm async:verify
```

认证与会话（M2-01 已验证，需要 Compose 依赖）：

```bash
corepack pnpm auth:verify
```

资料与校园申请（M2-02 已验证）：

```bash
corepack pnpm profile:verify
```

组织成员与邀请（M2-03 已验证）：

```bash
corepack pnpm organization:verify
```

强制 RLS 与隔离（M2-04/M2-05 已验证）：

```bash
corepack pnpm isolation:verify
```

个人记忆（M3-01/M3-02/M3-03 已验证）：

```bash
corepack pnpm memory:verify
corepack pnpm memory:maintain
```

AI Provider 与工具（M3-04 已验证）：

```bash
corepack pnpm ai:verify
corepack pnpm ai:eval
```

Agent 运行时与流式（M3-05 已验证）：

```bash
corepack pnpm agent:verify
corepack pnpm agent:maintain
```

行动确认（M3-06 已验证）：

```bash
corepack pnpm action:verify
```

组织与机会（M4-01–M4-05 已验证）：

```bash
corepack pnpm opportunity:verify
corepack pnpm opportunity:maintain
corepack pnpm org:verify
```

首条业务闭环（M5-01–M5-07、M5-09 已验证）：

```bash
corepack pnpm m5:verify
```

日程、忙闲与活动（M6-01–M6-04、M6-01R 已验证）：

```bash
corepack pnpm m6:verify
```

个人连接邀请与保留清理（P2P-01–03，需要 Compose 与 0030–0033 迁移）：

```bash
corepack pnpm connections:verify
corepack pnpm connections:verify:retention
corepack pnpm connections:maintain   # 受控清理一次；未配置生产自动调度
```

个人连接站内通知（M6-06A1，需要 0034、Compose 和已构建 API/Worker）：

```bash
corepack pnpm notifications:verify
corepack pnpm notifications:maintain   # 清理 90 天前收件箱；非生产自动调度
```

首次启动、端口、迁移校验和失败、Playwright/Expo 故障处理见 [开发环境启动](docs/development/SETUP.md)。

当前可用的环境检查：

```bash
node -v
corepack --version
docker --version
psql --version
```
