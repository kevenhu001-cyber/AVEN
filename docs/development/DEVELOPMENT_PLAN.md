# AVEN 详细开发计划

版本：1.1 · 日期：2026-11-10 · 状态：契约已修订，应用待实施

需求来源：[原始产品与工程规格](../../Origin%20Plan.md)。启动背景：[首次工作区评估](START_HERE.md)。

本文把原规格转化为可执行工作，不将规划、脚手架、开发数据或 Mock 演示标为功能完成。阶段状态只依据实际代码与验证结果更新。

## 1. 交付目标与范围

AVEN 的首个试点是西安交通大学的科研机会与合作连接。核心目标是让个人和组织在明确授权下发现彼此，并形成可持续的合作与现实行动。

### 1.1 三个交付层次

| 层次 | 交付内容 | 完成依据 |
|---|---|---|
| 工程基础 | 可运行、可验证、权限边界清晰的开发环境 | M0、M1 和身份基础验收通过 |
| 首条业务闭环 | 机会发布、个人需求、解释性匹配、引荐、双向确认、关系空间、撤销授权 | M5 的首条端到端旅程及越权测试通过 |
| 试点 MVP | 原始规格的个人与组织 AI、长期记忆、完整匹配、Android、日程活动和运行保障 | M0–M7 全部验收，原规格 18 项 DoD 逐项有证据 |

首条业务闭环通过后，且真实数据准入门通过，才可开展受控试点；不能据此宣布完整 MVP 已完成。按 ADR-008 先实现确定性闭环，不一次铺齐所有模块与可选扩展。

### 1.2 首条用户旅程

1. 组织管理员建立组织，发布真实科研机会，设置要求、截止时间与可见范围。
2. 个人建立账号，确认兴趣、技能、项目经历，创建寻找科研合作的需求。
3. 系统使用允许参与匹配的信息进行过滤与排序，展示可验证的推荐原因。
4. 个人查看机会详情，选择本次共享的资料、接收主体、用途及有效期。
5. 个人确认发送引荐，组织获授权成员在收件箱接受、拒绝或请求补充资料。
6. 双方接受后，在事务中建立唯一关系；仅引用独立确认的关系用途快照，未确认时共享上下文为空。
7. 用户撤销指定授权，系统立即拒绝相应内容的新读取，并处理缓存、检索与异步任务中的残留访问。

### 1.3 暂缓扩展的内容

不在首条闭环前扩展无限信息流、支付、复杂推荐训练、自由协商的多 Agent 系统、复杂场地优化、多校园运营和高度定制的组织报表。

iOS 保留技术路径并进行条件允许的验证；原生 Android 与组织 Web 是完整 MVP 的必要验收项。语音输入属于后续版本。

## 2. 当前基线与执行方式

- M0-02 已建立 pnpm/Turbo workspace、锁定依赖与 strict TypeScript/lint；M0-03 已建立 Web/API/Worker/Expo 骨架并通过实际构建，真机与原生流式验证未完成；M0-04 已建立 Compose、PostgreSQL/Redis 与逐用途数据库角色；M0-05 已建立迁移 runner、D1 表、只读 RLS 与开发 seed；M0-06 已接入真实依赖就绪检查与 Web/Expo 探针；M0-07 已建立 Outbox/BullMQ 样例、消费回执与故障注入；M0-08 已定义 CI 工作流、启动/故障文档与部署网络初查；M1-01 已实现语义/状态色、排版、断点、深色主题与减少动态令牌；M2-01 已实现 Argon2id、不透明会话、CSRF、限流、邮箱验证与密码重置；M2-02 已实现资料更新、校园列表与校园成员申请；M2-03 已实现组织创建、成员、邀请/接受、角色与最后 owner 保护；M2-04 已强制 21 张表 RLS；M2-05 已通过跨账号/跨组织隔离验证；M3-01 已实现手工确认记忆、来源、字段策略与软删除；M3-02–M3-07 已实现候选复核、生命周期、Provider/工具、Agent 运行时与流式、行动确认与评估预算；M4 已实现组织资料、机会生命周期、组织控制台、组织 Agent 与边界验证；M5 已实现意向与可解释候选、用途授权、引荐双向决定、原子建联、共享上下文与撤销传播；M6 已实现忙闲、忙闲用途授权共享、多方求交与活动状态机。当前共 34 个迁移、53 张 public 租户表与 3 张 app 租户表（全部 FORCE RLS）；P2P-01–03 补充个人连接、共享客户端/读取协议与正文保留清理。
- 已有原始规格、启动建议、本计划、M0-01 文档集及 M0-02/03/04/05/06/07/08、M1-01、M1-07 原型、M2-01–M2-05、M3-01 交付记录；README 说明当前状态。
- 2026-11-11 复检：Node v24.19.0、npm 11.17.0、pnpm 12.18.0（Corepack）、Docker 29.1.3 可用、PostgreSQL 客户端 16.14、无 Android SDK/adb；Next/Nest/Expo 最小构建已实际通过。
- PostgreSQL 17.11 与 Redis 7.4.12 已通过 Compose 启动并验证角色隔离；D1 空库迁移、已有库升级、seed 幂等、RLS 读策略、API/Worker 就绪检查与 Outbox 故障恢复已实际验证。扩展按 ADR-008 启用门单独验证；CI 尚未在 GitHub Actions 实跑。
- 仓库与后续工程文档使用 AVEN，原始规格中的 PAN 代号保留。
- 项目初期采用直接推送 `main` 的方式；需要审查、多人协作或高风险变更时再开分支 + PR。

每项工作分为 `TODO → IN_PROGRESS → REVIEW → DONE`；遇到外部阻塞记录原因和下一步，不将阻塞视为完成。M0-02、M0-04、M0-05、M0-06 与 M0-07 的限定工程包已交付，M0-08 尚缺 CI 实跑；M0-03 骨架与构建已完成但真机验证未完成；实际执行状态记录在第 19 节，只有交付并验证后才更新。文档修订单独记录，不推进应用里程碑。

任务编号保持稳定，可用于分支、提交和后续 issue。任务实施者负责代码及验证，验收按本文标准执行；具体人员在实际开始任务时记录，不预设不存在的团队配置。

不按固定日期强行推进：先验证依赖，再估算工作量。首条闭环稳定后安排试点日期；模型接入、运行环境和身份方案的未决问题必须计入估算。

## 3. 架构与模块职责

### 3.1 基本决策

沿用模块化单体、API-first、移动端优先、隐私优先和工作流 Agent。先保证模块边界和事务一致性，不拆微服务。

| 单元 | 职责 | 约束 |
|---|---|---|
| `apps/web` | 个人 Web 与组织控制台 | 业务访问经 API，不直接连接数据库 |
| `apps/mobile` | Expo 原生移动端 | 共用 API，独立导航、输入与设备适配 |
| `apps/api` | NestJS 身份、授权与业务服务 | 请求验证、权限、事务和业务状态的权威入口 |
| `apps/worker` | 记忆、索引、匹配、通知等后台任务 | 调用受控业务入口，执行时复核授权；不重写业务规则 |
| `packages/contracts` | Zod Schema、DTO、事件与权限定义 | 客户端和服务端共同依赖，无数据库实现依赖 |
| `packages/database` | Drizzle Schema、迁移与数据库访问基础 | 唯一迁移来源，限制可访问包 |
| `packages/service-health` | API/Worker 共享的存活/就绪探针 | 不含业务规则，不被 Web/Mobile 依赖 |
| `packages/api-client` | 请求、错误、鉴权接入和流式消费 | Web/Mobile 共用，不混入 UI 状态 |
| `packages/design-tokens` | 颜色、间距、字号、圆角和主题 | 输出 Web 与原生可用值 |
| `packages/config` | TypeScript、lint 等公共配置 | 启用 strict，避免隐式 any |
| `packages/ai-core` | Provider 与工具契约、运行时共用逻辑 | M3 按实际需求创建；Agent 无原始数据库访问权 |
| `packages/ui-web` | 复用 Web 组件 | M1 按实际复用需求创建，不强制移动端复用 |

迁移统一放在 `packages/database/migrations`；基础设施脚本放在 `infra`。不再并存另一套业务迁移目录。

### 3.2 服务边界

Identity/Principal 管身份，Organization 管组织与成员，Memory 管确认后的上下文，Consent 管用途授权，Opportunity/Intent 管供需，Matching 管候选与解释，Relationship 管共享空间，Agent 管运行与行动，Calendar/Event 管协调，Audit/Outbox 管操作证据和可靠投递。

模块间通过服务接口交互。Agent 工具调用这些服务，不允许任意拼接 SQL。Worker 的跨进程代码复用方式在 M0 的 TDD 中确定，不能靠复制 API Service 解决。

### 3.3 M0 必须记录的决策

| 决策 | 要解决的问题 | 关闭条件 |
|---|---|---|
| ADR-001 运行时 | Node、pnpm、框架与原生依赖是否兼容 | 查官方要求，最小构建通过，版本锁定 |
| ADR-002 身份 | 账号、会话、恢复、Web/Mobile 凭据生命周期 | 确定提供方/实现、令牌验证和会话撤销方案 |
| ADR-003 数据运行 | 本地 PostgreSQL、Redis、扩展和存储如何提供 | 新环境可按文档启动并执行迁移 |
| ADR-004 → ADR-007 数据授权 | 字段用途、运行角色/认证函数、事务身份与快照绑定 | 非特权角色、启动认证、隔离与撤销竞争实测 |
| ADR-005 异步执行 | API/Worker 如何共享业务规则与处理 Outbox | 事务与队列边界、重试和幂等方案确定 |
| ADR-006 AI 接入 | Mock、真实 Provider、数据发送范围如何隔离 | 可配置契约、密钥管理、真实验证入口确定 |

已选择自有认证/会话方向，具体认证库、模型与云供应商待评估。新增 ADR-007 取代数据授权基线，ADR-008 部分取代扩展预装/延后部署调查要求；具体以 ADR 索引为准。已接受的旧 ADR 保留历史正文，仅标注被取代关系。

## 4. 阶段路线与依赖

原规格的里程碑编号保持不变；阶段之间允许按业务依赖穿插推进。

| 阶段 | 核心交付 | 前置条件 |
|---|---|---|
| M0 基础工程 | 文档、Monorepo、四应用骨架、数据库、队列、CI | 仓库和开发环境准备 |
| M1 设计系统 | 主题、导航、组件、移动适配、页面状态 | M0 的前端骨架 |
| M2 身份与组织 | 登录、主体、组织成员、RLS 与资源权限 | M0 数据及鉴权决策 |
| M3 个人智能 | 手工确认资料、记忆复核、个人 Agent、流式与行动 | M2 个人身份；M1 交互基础 |
| M4 组织智能 | 组织资料、机会发布、组织 AI 草稿 | M2 组织权限；M3 Agent 基础 |
| M5 匹配与关系 | 供需匹配、授权、双方确认、关系空间、撤销 | M3 已确认资料；M4 真实机会 |
| M6 生活协调 | 忙闲授权、时间提案、活动确认、通知 | M5 授权及关系基础 |
| M7 试点发布 | Android/Web 全链路、运行保障、真实试点 | M0–M6 验收通过 |

实施中先做 M3 的手工资料和 M4 的机会 CRUD，再推进 M5 的确定性闭环；随后补齐 M3/M4 的完整 AI 与 M5 的向量匹配。此过程不提前关闭尚未满足全部条件的里程碑。

## 5. M0：基础工程

| 编号 | 工作包 | 具体内容与交付 |
|---|---|---|
| M0-01 | 最小产品与工程文档 | 建立 AGENTS、PRD、DESIGN_SYSTEM、TDD、SCHEMA，提取原规格要求；写清首条旅程、模块边界与非目标 |
| M0-02 | 依赖与运行时 | ADR-001 官方兼容矩阵；锁定版本、packageManager/lockfile；workspace、Turbo、strict TS/lint；不要求尚无骨架的四应用构建 |
| M0-03 | 应用与共享包 | Web/API/Worker/Expo 最小骨架与实际构建；记录真机连接及 Web/原生流式能力探针，推进 ADR-001 实测项 |
| M0-04 | 基础设施 | Compose/环境模板；启动 PostgreSQL/Redis，基础迁移不依赖扩展；逐用途角色/连接池，pgvector 与 PostGIS 按启用门另验 |
| M0-05 | 迁移及测试数据 | 建立唯一迁移流程；空库迁移、已有库升级；显式开发 seed；说明失败的前向修复方案 |
| M0-06 | 服务可用性 | 区分存活和就绪；API/Worker 的就绪检查验证实际依赖；Web/Mobile 调用健康接口 |
| M0-07 | 异步可靠性样例 | 最小任务与 Outbox/消费回执；故障注入覆盖租约到期、入队后崩溃、Redis 重启、重复消费与未知外部结果 |
| M0-08 | CI 与开发说明 | push/PR 实际执行安装、lint、类型、必要测试、迁移与构建；README 保留实测命令；记录候选部署地域/预算/校园与移动网络初查 |

验收门槛：新环境可按文档启动；Web/API/Worker 可用；Expo 能连接 API；空库迁移和基础 CI 通过；服务不可用时就绪失败；无需真实模型密钥即可开发。

M0 不以空页面或能运行安装命令替代数据库、Worker 与移动端启动证据。

## 6. M1：设计系统与应用外壳

| 编号 | 工作包 | 具体内容与交付 |
|---|---|---|
| M1-01 | 令牌与主题 | 按原规格实现浅深色、字体、间距、圆角；覆盖缺失状态令牌与对比度；支持减少动态效果 |
| M1-02 | 导航与布局 | 桌面收起侧栏、居中会话区、按需上下文面板；手机抽屉与底部输入区、Stack；长内容滚动与返回（以 v0.3 评审为准） |
| M1-03 | 基础组件 | Button、Input、Dialog、Popover、List、表单、Toast/反馈；焦点管理、键盘和屏幕阅读支持 |
| M1-04 | 业务组件 | AI Composer、机会摘要、授权预览、工具状态、来源引用；明确文本生成与任务执行状态 |
| M1-05 | 页面状态 | 每页适用状态矩阵，不适用项说明原因；业务失败与恢复不被通用错误代替 |
| M1-06 | 布局验证 | Playwright/视觉基线、文字缩放/回流、键盘和屏幕阅读；development build 真机记录 Safe Area、返回、长列表/流式卡顿 |
| M1-07 | 核心旅程设计评审 | 按 CORE_JOURNEY 交付桌面/手机高保真与可点击原型、真实中文样例、授权与组织身份交互；对应页面 UI 编码前通过 |

验收门槛：主题与关键页设计有版本化评审证据，导航仅显示开放能力，移动端无关键遮挡；组件有真实行为，视觉回归不代替 E2E。M1-07 可作为纯设计工作与 M0 并行，不要求先初始化应用；文档描述不算高保真稿完成。

## 7. M2：身份、组织与资源权限

| 编号 | 工作包 | 具体内容与交付 |
|---|---|---|
| M2-01 | 认证与会话 | 编码前评审成熟可自托管库/安全维护成本及威胁模型；验证邮件、认证池/函数、签名 CSRF、会话撤销、恢复、限流与安全存放 |
| M2-02 | 主体与校园身份 | Principal 与子实体类型一致；个人资料；校园 membership 与认证状态分开，不伪称官方认证 |
| M2-03 | 组织成员 | 创建组织、邀请/接受、管理员/成员角色、移除与离开；防止组织失去最后一名管理员 |
| M2-04 | 授权基础设施 | 默认拒绝；资源级检查；事务本地身份上下文；RLS 与非绕过角色；组织操作主体显式绑定 |
| M2-05 | 隔离集成测试 | 至少两个个人、两个组织及不同角色；测试同组织/跨组织读取写入、伪造主体、成员移除与连接池复用 |

验收门槛：个人和组织能独立登录/操作；客户端不能通过传入组织 ID 获取组织权限；越权在 API 和数据库层受控；开发身份不能在生产启用。

## 8. M3：个人上下文、记忆与 AI

| 编号 | 工作包 | 具体内容与交付 |
|---|---|---|
| M3-01 | 已确认个人上下文 | 手工增改兴趣、技能、项目、目标与偏好；来源、版本、敏感度、用途、有效期；持久化和所有权检查 |
| M3-02 | 记忆复核 | 提取生成待确认候选；用户接受、修改、拒绝；只有确认且允许使用的信息进入相应检索范围 |
| M3-03 | 记忆生命周期 | 编辑、失效、删除、索引清理与关联授权影响；历史审计与内容保留策略分开 |
| M3-04 | Provider 与工具 | 可配置 Mock/真实 Provider；Zod 参数和返回值；工具权限、超时、重试上限、审计；限制工具与模型数据范围 |
| M3-05 | 运行时与流式 | POST 创建 run + GET SSE；持久事件/来源依赖、24 小时清理、游标、取消、重放鉴权与真实代理/原生流验证 |
| M3-06 | 行动预览与确认 | 草稿绑定内容版本、有效期和一次性执行标识；正式执行重新鉴权；重复确认不重复写入 |
| M3-07 | 个人页面与评估 | 个人独立会话、记忆复核；接入前登记脱敏评估集/阈值、来源支持、越权阻断、延迟/成本/工具次数预算；记录实际模型/配置与失败 |

验收门槛：私人记忆不会因参与对话自动对外共享；用户可纠正理解；Mock 明示；至少一个真实 Provider 验证成功与错误路径；行动仅在有效确认后执行。

## 9. M4：组织资源与机会（后端主线已交付，阶段未验收）

| 编号 | 工作包 | 具体内容与交付 | 状态 |
|---|---|---|---|
| M4-01 | 组织资料与上下文 | 组织介绍、项目、负责人、可公开信息；编辑与组织记忆的权限独立检查；`update_organization`、`get_public_organization` 已交付 | [x] 已完成（提交 `ae1d0c3`，`opportunity:verify` 验证） |
| M4-02 | 机会生命周期 | 草稿、发布、暂停、关闭、到期；要求、人数、时间投入、负责人、可见范围、来源与版本；`opportunities` 表与 9 个数据库生命周期函数已交付 | [x] 已完成（提交 `ae1d0c3`，`opportunity:verify` 34 项全通） |
| M4-03 | 组织控制台 | Overview、机会管理、成员列表、收件箱占位；具备 loading/empty/error/success/denied 完整状态矩阵；遵守 `@aven/design-tokens` | [~] PARTIAL：路由已实现，收件箱占位；正式双端评审与业务 E2E 未完成 |
| M4-04 | Organization Agent | 组织范围检索（`opportunity.search`、`organization_context.search`）、机会草稿动作提议（`opportunity_draft.create`）；发布前预览且由有权限成员确认 | [x] 已完成（迁移 0019–0021，Worker 隔离加载，`app.confirm_opportunity_create_action` 落地） |
| M4-05 | 组织边界测试 | 非成员/普通成员防越权；成员移除后旧草稿确认阻断；私人资料严格不混入组织输出；强制 RLS 验证 | [x] 已完成（`pnpm org:verify` 25 项真实端到端/数据库检查全绿通过） |

验收门槛：机会真实存储并可更新关闭；过期和暂停机会不参与新推荐；AI 草稿不自动发布；组织收件箱只展示本组织有权访问的数据。已有后端检查不代替正式设计评审、组织收件箱业务接通、真实 Provider 与双端验收。

## 10. M5：匹配、引荐、关系与授权撤销

| 编号 | 工作包 | 具体内容与交付 |
|---|---|---|
| M5-01 | 需求与过滤基线 | 个人创建需求；真实机会按学校、领域、阶段、期限、意愿和屏蔽关系过滤；保存版本及证据 | [x] DONE |
| M5-02 | 语义召回与排序 | 启用 pgvector/具体模型维度迁移；逐来源/策略版本的允许集合，特征排序/召回/解释评估；不足时明确空结果 | [~] PARTIAL：仅确定性特征打分，无向量召回 |
| M5-03 | 用途授权 | 字段策略、服务端短期预览、业务对象/用途绑定、不可变快照与复合外键；引荐/关系用途独立确认，关系可为空上下文 | [x] DONE |
| M5-04 | 引荐与双向决定 | 候选/正式引荐分表，/referrals 发送/补充/决定/撤回；终态重发保留历史，内容版本与行版本分开，禁止组织提前读候选 | [~] PARTIAL：发送/决定后端已验证，补充资料接口未实现 |
| M5-05 | 关系建立事务 | 接受时重新校验机会、成员权限、双方决定与授权；锁/版本校验；唯一约束防重复空间；Outbox 同事务写入 | [x] DONE |
| M5-06 | 关系空间 | Overview、成员、共同目标、会话与共享上下文；参与者校验；共享快照绑定原授权与来源版本 | [~] PARTIAL：成员/共享上下文后端已验证，会话/消息 API 未实现 |
| M5-07 | 撤销传播 | 读取入口立即检查撤销；清理/失效缓存、索引和任务；共享链接无绕过；其他独立有效授权单独判断 | [x] DONE |
| M5-08 | Android 业务接通 | development build 真机完成主线；弱网幂等、结果未知、会话/授权失效、身份切换、深链和前后台恢复；不以 Expo Go 代替 | [ ] 未开始 |
| M5-09 | 首条旅程验收 | 两个账号代表个人与组织走完整主线；并发接受、重复请求、过期草稿、拒绝与越权场景通过 | [~] REVIEW：后端确定性闭环已验证，产品 Web/Android 验收未完成 |

验收门槛：真实数据完成完整主线；每条解释对应允许使用的证据；只有双方接受才建立关系；撤销后系统不继续返回相应内容；Web 与 Android 核心流程通过。

撤销提交后主库新授权检查拒绝；已通过检查的在途字节/外部副本无法保证收回，流式后续批次和副作用前复核。审计只保留必要元数据，幂等/SSE/缓存不成为旧正文读取通道。

## 11. M6：日程、活动与通知

| 编号 | 工作包 | 具体内容与交付 |
|---|---|---|
| M6-01 | 日程与忙闲 | 个人日程与忙闲块；统一 UTC 时间戳并保留时区；区分全天/重复事件及边界；仅共享获授权忙闲 | [x] DONE（共享授权见 M6-01R） |
| M6-02 | 外部日历 | 选择并验证一种可用连接方式；凭据加密、撤销、同步游标与失败恢复；其他连接器明确未支持 | [~] PARTIAL：仅有数据底座，无 OAuth 连接器 |
| M6-03 | 可用时间求交 | TypeScript 确定性计算日期范围、时长、参与者和工作时段；覆盖无交集、跨天和夏令时样例 | [x] DONE |
| M6-04 | 活动状态 | 草稿、提案、等待确认、成立、取消、结束；参与人响应独立记录；候选变化使旧确认失效 | [x] DONE |
| M6-05 | AI 协调 | 模型提取约束，业务求解器计算候选；缺失约束要求补充；不直接修改所有人的外部日历 | [ ] 未开始 |
| M6-06 | 通知投递 | 站内通知及所选移动推送；Outbox、幂等、失败重试、去重、用户偏好和死信人工处理 | [~] PARTIAL：个人连接站内通知已交付；活动/移动推送/UI 待实现 |

验收门槛：真实多人提供授权忙闲后产生合法候选，按明确确认规则成立活动；取消/改期可追踪；忙闲接口不暴露日程标题或私人细节；通知失败不损坏活动状态。

## 12. M7：试点与发布准备

| 编号 | 工作包 | 具体内容与交付 |
|---|---|---|
| M7-01 | 运行保障 | 结构化日志、request/run/job ID、错误追踪、指标、告警、慢查询与任务失败定位；日志脱敏 |
| M7-02 | 数据保障 | 复验真实数据准入前已建立的备份/恢复、迁移顺序与前向修复；验证文件链接与下载权限 |
| M7-03 | 产品衡量 | 初始化、记忆确认、引荐接受、双方确认、实际交流、活动确认与隐私事件；定义分母和状态口径 |
| M7-04 | 网络与部署 | 复验 M0 初查与真实数据准入结论；校园/移动网络验证 API、模型、存储、推送、日历和数据处理边界 |
| M7-05 | 发布候选 | Android 构建安装、Web 组织端、健康/告警、兼容性、限流、依赖安全与性能检查 |
| M7-06 | 真实试点 | 招募明确同意的组织与个人，使用真实机会和活动；支持渠道、问题分级、数据删除与反馈流程 |
| M7-07 | 试点复盘 | 汇总实际连接、交流与协调结果；记录失败原因、隐私问题与优先级，形成下一版计划 |

验收门槛：原规格 DoD 18 项全部逐项关联验证证据；无未解决的阻断性权限或数据问题；恢复演练通过；真实用户旅程可完成。公开发布前明确检查点与负责人。

### 12.1 真实数据准入门（早于 M7）

任何受控试点或真实 Provider 数据发送前，必须登记负责人、证据与未决风险：

- 候选部署地域/校园与移动网络、生产邮件、数据位置、供应商保留与处理范围已确认；不默认海外服务可用。
- 隐私告知/同意、组织认证与机会维护、举报/支持/删除/退出流程可执行；不以技术 ConsentGrant 代替适用法律义务评估。
- 无阻断越权、重复副作用和删除/撤销缺陷；备份实际恢复，恢复后不复活已撤销授权，RPO/RTO 与保留期已登记。
- Web 首屏/交互、原生目标设备、API/队列和 AI 延迟/费用预算有测量条件与结果；样本不足时不将实验室数据冒充真实 p75。
- 设计评审、关键旅程行为测试与试点验收目标已登记；不满足时只可用明确样例演示，不接纳真实私人数据。

## 13. 数据设计与状态机要求

### 13.1 分批迁移

| 批次 | 主要实体 | 必须同时交付 |
|---|---|---|
| D1 身份组织 | Principal、User、Campus、Membership、Organization | 类型一致、唯一关系、角色约束、RLS |
| D2 个人与机会 | MemoryItem/Source、ContextFieldPolicy、Intent、Opportunity、Project | 所有权、字段用途、逐来源版本、期限、按需索引 |
| D3 引荐授权 | MatchCandidate、Referral/Decision、ConsentPreview/Grant/Item/Event | 候选隔离、业务绑定、预览版本、独立用途、快照不可变 |
| D4 关系与对话 | Relationship/Member、SharedContextItem、Conversation/Member、Message | 并发唯一性、成员校验、授权快照读取规则 |
| D5 智能与可靠性 | AgentRun/Step/Event/Source、ToolInvocation、MemoryEmbedding、OutboxEvent/JobReceipt、AuditLog、Notification | 事件先存后发、来源依赖、租约恢复、消费回执、审计脱敏 |
| D6 日程活动 | CalendarConnection、AvailabilityBlock、Event/Participant | 时区、外部凭据保护、确认版本与冲突规则 |

该表是业务批次，不是严格迁移顺序：Audit/Outbox 随首个实际业务写操作落地，Agent 表随 M3 落地，不能等到 D5 才补可靠性。

每个迁移须包含索引与约束、权限策略、存量数据处理、空库/升级验证和恢复策略。普通请求使用不绕过 RLS 的运行角色；请求上下文在事务内设置，避免连接池串身份。

### 13.2 状态转换原则

- 记忆：候选待确认、已确认、已拒绝、已失效/删除；仅许可且已确认的版本参与对应用途。
- 机会：草稿、开放、暂停、关闭、到期；编辑变更版本，接受时复核可用性和人数约束。
- 候选：active/stale/dismissed，仅本人/匹配任务；引荐独立保存 sent/info_requested/accepted/declined/withdrawn/expired，双方决定绑定 content_version。
- 授权：有效、撤销、到期；范围变更产生新版本，不能原地扩大已确认内容。
- 行动：草稿、等待确认、执行中、成功、失败、取消、过期；重试遵守业务幂等。
- 活动：草稿、候选提案、等待确认、已成立、已取消、已结束；确认绑定提案版本。

实施前在 TDD 中定义合法转换、操作者、事务边界、并发冲突和错误码，随后为这些规则编写有业务意义的测试。

## 14. 接口与流式契约计划

沿用 `/api/v1`、REST 和统一错误结构。以下新增路径为契约设计候选，编码前在 `docs/api` 中确定请求、响应与兼容策略。

| 能力 | 核心接口范围 |
|---|---|
| 身份组织 | `/me`、`/me/permissions`、组织及成员管理 |
| 记忆 | `/memories`、提取、确认/拒绝、来源与版本 |
| 供需 | `/intents`、`/opportunities`、状态转换与查询 |
| 匹配/引荐 | /matches 仅本人候选；/referrals 发送/详情/decisions/supplements/withdraw |
| 授权 | POST /consents/preview、POST/GET /consents、GET /consents/:id、POST /consents/:id/revoke |
| 关系 | `/relationships`、`/:id/context`、`/:id/close` |
| 智能行动 | POST /agent/turns 创建，GET /agent/runs/:id/events 订阅/恢复；run 查询/取消，独立行动确认 |
| 异步任务 | `GET /tasks/:id`，响应包含状态、错误、可重试性和归属权限 |
| 日程活动 | `/calendar`、`/availability`、`/events`、提案与确认 |

写操作按业务需要采用幂等键，绑定主体、接口及请求内容摘要；重用同键但内容变化应返回冲突。版本冲突不静默覆盖。

POST JSON 创建 run，GET SSE 通过支持 Cookie/Bearer 的 fetch 客户端消费；定义事件 ID、schema 版本、终止事件、注释心跳、24 小时保留窗口和恢复游标。恢复重验来源授权，只读已有 run，不重发写请求。核心端点已在 docs/api/CORE_CONTRACTS.md 定义，其他端点编码前补齐，不以文字清单算可用。

工具状态与文字生成状态分开；错误区分权限拒绝、业务冲突、Provider 限流、超时和网络断开，不返回密钥、内部提示词或未授权上下文。

## 15. 测试与完成标准

### 15.1 按风险分层

| 层级 | 必测内容 | 主要阶段 |
|---|---|---|
| 单元 | 权限、授权有效性、合法状态转换、匹配过滤、时间求交、幂等规则 | M2–M6 |
| 数据/集成 | 非特权 RLS、连接池隔离、事务并发、Outbox、队列、迁移、索引授权过滤 | M0–M6 |
| 契约 | Zod 输入输出、统一错误、事件格式、版本与重连 | 各 API 交付时 |
| Web E2E | 个人初始化、组织发布、双方引荐、撤销、活动协调与错误恢复 | M3–M7 |
| Android | 登录、核心主线、键盘、Safe Area、弱网、重复点击、会话失效 | M1/M5–M7 |
| AI 评估 | 来源支持、结构化输出、注入、工具参数伪造、权限、取消及真实 Provider 失败 | M3–M7 |

不为静态文档或低风险样式编写镜像测试。核心权限、并发和状态转换必须有实际可失败的测试，而非只验证函数被调用。

### 15.2 端到端验收旅程

保留原规格 A–E，并细化为：A 个人注册/资料/项目/需求；B 组织注册/成员/机会；C 发现/预览/个人同意/组织接受/关系；D 授权忙闲/候选/参与者确认/活动；E 撤销/缓存失效/检索拒绝/审计记录。

增加反向用例：第三方猜测 ID、同组织低权限成员、被移除成员、过期机会、重复确认、同时接受、过期行动、撤销与读取竞争、任务重试及文件链接访问。

### 15.3 每个工作包的 DoD

1. 行为满足约定范围，并且数据库/API/界面有需要的同步变更。
2. 核心权限、输入输出、失败与重试路径实现并验证。
3. 迁移和必要索引、约束、RLS 随表一起交付。
4. 相关 lint、类型、测试、构建通过，保存执行命令及结果。
5. 文档与实际命令一致；开发数据、Mock 与限制明确标识。
6. 交付说明含文件变化、架构、数据库、API、测试、已知问题和后续任务。

仅文档提交执行文档链接、差异和敏感信息检查，不宣称应用测试通过。CI 门禁按实际内容逐步建立，未实现的检查不能放空脚本显示绿色。

## 16. 首批提交顺序

每项以可审查、可验证的结果为单位；若范围较大，拆为契约、实现和界面，但不能留下可误执行的半成品。

| 顺序 | 建议提交主题 | 对应任务 | 本次完成证据 |
|---|---|---|---|
| 0 | 项目规格与详细计划 | 规划基线 | 本文、README、原规格和仓库配置 |
| 1 | 最小产品与架构定义 | M0-01 | 六份必读文档、身份/权限边界与首批决策 |
| 2 | Workspace 与公共配置 | M0-02 | 锁定版本，最小依赖安装及类型检查 |
| 3 | 四应用运行骨架 | M0-03 | Web/API/Worker/Expo 启动记录 |
| 4 | 数据库、队列与环境 | M0-04/05 | Compose/等效运行说明、空库迁移、非特权角色 |
| 5 | 健康检查与异步验证 | M0-06/07 | 依赖故障就绪失败、任务重试与去重 |
| 6 | CI 与启动文档 | M0-08 | 从空环境完成规定检查 |
| 7 | 设计令牌与导航 | M1-01/02 | 主题、桌面导航与原生导航验证 |
| 8 | 身份和组织权限 | M2-01–05 | 跨账号、跨组织、角色和 RLS 测试 |
| 9 | 个人资料与机会发布 | M3-01/M4-01/02 | 真实持久化、编辑、权限和生命周期 |
| 10 | 授权引荐与关系 | M5-01/03–07 | 首条确定性闭环、并发与撤销证据 |

随后继续 AI、语义检索、Android 主线、日程和试点工作。表中“证据”是未来交付要求，不表示当前已完成。

## 17. 风险、处理与停止条件

| 风险 | 处理方式 | 何时必须解决 |
|---|---|---|
| 全端与多模块范围过大 | 以首条旅程推进，小步验收；完整 MVP 不缩减为页面演示 | 每阶段规划 |
| 身份方案长期未定 | M0 做最小决策与 Web/Mobile 会话验证 | M2 编码前 |
| 私人信息进入检索或解释 | 授权先过滤；来源可追踪；检索/缓存/任务均复核 | M3–M5 验收前 |
| 双方确认重复或授权已撤销 | 事务、版本、唯一约束、执行时再校验 | M5 验收前 |
| 模型或外部服务不可用 | Provider 抽象、真实失败测试、明确降级状态 | M3 与试点前 |
| 校园网络和部署不适配 | M0 初查，真实数据前关闭地域/邮件/处理边界，M7 复验 | 真实数据/Provider 发送前 |
| 本机依赖或 Android 环境缺失 | M0 检查并记录最小可复现环境 | M0 验收前 |
| 授权撤销只改数据库标志 | 读取端立即拒绝并测试下游失效，审计追踪处理 | M5 验收前 |
| 备份存在但无法恢复 | 实际演练并验证恢复后不复活已删除/撤销数据 | 接纳真实用户数据前 |

存在可复现的越权读取/写入、私人信息泄露、重复外部操作或数据迁移损坏时，暂停该功能发布，修复并补充回归验证后继续。

## 18. 规划轮交付与下一步

2026-11-12 M6-06A1：新增个人邀请 sent/accepted/declined/withdrawn/revoked 的站内通知，同事务 Outbox、独立队列与去重回执、当前业务/偏好复核、分页/已读、5 次失败/死信、平台管理员按代数重排和 90 天维护。34 个迁移、56 张租户表 FORCE RLS。实际检查见 [交付记录](NOTIFICATIONS.md)。活动通知、移动推送、产品 UI、生产调度与告警尚未完成，M6-06/M6-06A 保持 PARTIAL。


2026-11-12 系统复核：当前是“后端确定性能力 + Mock Agent + 设计原型”，尚非完整产品。详见 [系统缺口与推进顺序](SYSTEM_STATUS.md)。纠正 M0-08、M4-03、M5-04、M5-06、M6-02 为 PARTIAL，M5-09 为 REVIEW：原交付证据保留，但 CI 实跑、收件箱/设计验收、补充资料、会话/消息、真实日历和产品双端验收尚未满足整包范围。此为状态纠偏，不表示已实现功能回退。

P2P-03 本轮补齐个人邀请预览与失效共享正文保留清理、来源到期后延长不复活、元数据保留和 Worker 权限边界。新增 0033，实际检查结果见 [本轮交付记录](CONNECTION_RETENTION.md)。没有交付自动调度、通知、产品聊天组件或真实 AI。

优先顺序：M1-07 正式双端评审 → 登录/对话壳与连接小组件；可独立推进 M6-06A2 活动通知 → 个人连接会话/消息 → 通知推送及原生接通。真实 Provider 和向量召回需分别满足数据发送/模型与维度验证门，不能用 Mock 关闭。试点前还须完成拉黑举报、限流、删除与恢复演练、生产网络/邮件和 CI 实跑。

2026-11-12 P2P-02 接入层：新增共享个人连接 API 客户端和小组件读取协议；逐次传入 Web Cookie/CSRF 或移动 Bearer，在同事务中返回会话角色、邀请元数据与当前授权快照。无新迁移、正文缓存或自动重试，不承载 UI 状态。12 项构建、71 项真实 HTTP/数据库检查、179 项单测、类型与 lint 通过。详见 [交付记录](CONNECTION_CLIENT_WIDGET.md)。本轮没有产品小组件或 Agent/插件绑定，M1-07 评审门不变；不能描述为聊天接入或跨终端设备验收。

2026-11-12 P2P-01 后端轮：按新的个人社交连接方向交付独立预览、记忆正文用途授权、幂等邀请、双方决定、原子唯一连接、撤回和撤销，不复用组织/机会关系表。新增 0030–0032、4 张 FORCE RLS 表及受控函数，Drizzle/契约/API/验证同步。32 个迁移、184 项数据库检查、隔离库与开发库各 53 项个人连接 HTTP 检查通过；组织闭环 21/21、日程 37/37、单测 167/167、类型、lint、格式、12 项构建和诊断页 E2E 6/6 通过。`check:expo` 仍失败（推荐补丁未升级）。详见 [交付记录](PERSONAL_CONNECTIONS.md)。该记录仅关闭 P2P-01 后端范围，UI、发现、通知、共同会话、真实 Provider 与原生验收仍未完成，正式设计评审门不变。

2026-11-12 用户反馈修订：v0.2 被指出业务页面喧宾夺主，改用 [v0.3 会话与连接原型](../design/prototypes/m1-07-v3/index.html)。读取本机 Socrates 聊天截图、主题、输入区和插件菜单实现，适配 Geist/Noto 字体、黑灰表面和紧凑侧栏；按用户进一步要求统一精致圆角并移除光影。连接建议、共享确认、邀请状态与对方决定在会话中呈现，手机取消业务底栏。五个宽度通过 55/56/55/53/53 次原型断言（含 200% 文字与无光影检查），详见 [设计自检](../design/prototypes/m1-07-v3/design-qa.md)。仍为 REVIEW，不宣称正式评审、跨终端、个人到个人 API、真实插件或产品 UI 已实现；Socrates 项目只读未修改。

2026-11-12 产品设计轮：按用户提供的 ChatGPT 深色截图新增 `docs/design/prototypes/m1-07-v2/`，保留 v0.1。覆盖 AI、记忆、设置与八项核心旅程，共 11 个设计视图；头像菜单、侧栏/手机底栏、搜索、授权字段与期限、组织处理、独立用途撤销等均为可点击样例。通过 T3 `html_preview` 在 320/390/768/1024/1440 五个宽度执行原型断言，分别 134/134/129/129/129 次通过，含 200% 文字回流；浏览器渲染无控制台错误。修复 320px 放大下输入区溢出，保存截图并与参考图并排比较。详见 [v0.2 说明](../design/prototypes/m1-07-v2/README.md) 与 [设计自检](../design/prototypes/m1-07-v2/design-qa.md)。M1-07 保持 REVIEW，正式产品/工程评审、真实设备、屏幕阅读器与业务 E2E 未执行；不改变 M1-02–M1-06 未编码状态，不计为通知、真实 AI 或产品功能交付。

2026-11-11 本轮收口求交可靠性：领域求解器对无效日期、非正整数时长/步长、非法工作时段和反向/无效忙闲区间返回空数组，避免把错误输入当作可用时间。M6 验证脚本改用 UTC 构造日期，新增 7 项真实 HTTP 检查（输入边界、默认 UTC 工作时段与 31 天合法上限）。`format:check`、`lint`、`typecheck`、`test`（162/162）、`m6:verify`（37/37，含 12 项构建任务）、诊断页 E2E（6/6）通过；专项测试在 `TZ=Asia/Shanghai` 下通过（28/28）。没有数据库迁移或新增业务端点，未重跑空库/升级验证。Expo 推荐补丁安装因 `minimumReleaseAge: 720` 被拒绝，依赖清单与 lockfile 未变，`check:expo` 仍失败；不缩短等待期或添加豁免。详见 [求交可靠性交付记录](M6_RELIABILITY.md)。

2026-11-11 求交可靠性修复：工作时段改为固定 UTC，避免随服务器时区变化；求交输入限制为最多 50 个主体、31 天时间窗及 31 天时长。新增跨日和输入边界测试；各参与者的本地工作时段仍未实现，此修复不代表 M6-05 AI 协调完成。`format:check`、`lint`、`typecheck`、`test`（145 项）和 `build` 通过，`TZ=Asia/Shanghai` 的求交专项测试通过。`check:expo` 因多个 Expo 依赖低于当前兼容版本失败；`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` 为 4 通过、2 失败，失败断言要求首页显示当前代码中不存在的文案。未执行数据库与 M6 HTTP 回归。

2026-11-11 诊断页修正：恢复工程页与 MVP 的边界提示，修正组织入口、设计评审和就绪探针的状态文案；组织入口仍使用开发组织 ID 和现有权限检查。`corepack pnpm build`、`typecheck` 与 `PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e` 通过（桌面和移动网页共 6 项）；这不是核心旅程 E2E、双端设计评审或原生设备验收。Expo 依赖兼容性问题仍待处理。

规划轮范围：详细计划、README、Git 基础配置，以及将规划文档提交到指定 GitHub 仓库。未开展应用实现、依赖安装或数据库迁移。

M0-01 及契约修订见第 19 节。M0-02 已锁定 ADR-001 兼容矩阵并建立 workspace 与 strict TypeScript/lint；M0-03 已建立四应用骨架并通过 Web/API/Worker 构建与 Expo Android JS 导出，真机连接与原生流式探针仍待设备环境；M0-04 已建立 Compose、PostgreSQL/Redis、环境模板与数据库角色并通过隔离验证；M0-05 已建立迁移 runner、D1 表、只读 RLS 与开发 seed，并通过空库/升级/幂等验证；M0-06 已接入真实依赖就绪检查、统一 503 语义与 Web/Expo 探针；M0-07 已建立 Outbox/BullMQ 样例、消费回执、重试/死信与故障注入；M0-08 已定义 CI 工作流、启动/故障文档与部署网络初查；M1-01 已实现语义/状态色、排版、断点、深色主题与减少动态令牌；M1-07 已交付可点击原型与自检记录，正式双端评审待完成；M2-01–M2-05 已实现认证、资料/校园、组织成员、强制 RLS 与隔离验证；M3-01 已实现手工确认记忆、来源、字段策略与软删除；M3-02 已实现候选提取、确认/修改/拒绝与用途检索门；M3-03 已实现事件审计、到期失效、软删除保留与审计保留清理；M3-04 已实现 Provider 抽象、Mock、OpenAI-compatible 适配器契约与工具权限/超时/重试/审计；M3-05 已实现 Agent turn 创建、持久事件、SSE 重放、取消、来源复核与 24 小时清理；M3-06 已实现行动草稿、预览、一次性 token、幂等确认执行与取消；M3-07 已实现脱敏评估集、共享匹配/提示构建、来源支持/越权阻断/注入检查、延迟与 token/工具预算、聚合阈值与报告，个人页面/记忆复核 UI 仍受 M1-07 设计评审门阻塞；M4-01–M4-05 已实现组织资料、机会生命周期、组织控制台、组织 Agent 与边界验证；M5-01、M5-03–M5-07、M5-09 已实现意向、候选、授权预览、引荐双向决定、原子建联、共享上下文与撤销传播，首条确定性闭环全流程通过（M5-02 向量语义召回与 M5-08 Android 主线未实现）；M6-01–M6-04 与 M6-01R 已实现忙闲、忙闲用途授权共享、多方求交与活动状态机（M6-02 仅有数据底座，M6-05 AI 协调未实现，M6-06 仅个人连接站内通知已交付）。下一步是 M1-07 正式双端设计评审（通过后才能进入个人页面与 M1-02–M1-06 组件层编码）、M6-06 通知投递与语义召回的 pgvector 迁移；M0-03 真机补验与 GitHub Actions 实跑仍待环境，不能据此关闭对应验收。

## 19. 执行记录

| 任务 | 状态 | 日期 | 交付/证据 | 说明 |
|---|---|---|---|---|
| P2P-01 | DONE（后端范围） | 2026-11-12 | 0030–0032、连接模块、`connections:verify` | 个人邀请/双方决定/唯一建联；UI、消息和通知未实现 |
| P2P-02 | DONE（接入层范围） | 2026-11-12 | 共享连接客户端、widget 读取协议，71 项 HTTP/DB 检查 | 没有产品小组件、Agent 绑定与真实设备验收 |
| P2P-03 | DONE（保留清理范围） | 2026-11-12 | 0033、受控保留清理、显式维护与验证脚本 | 本轮执行结果见 CONNECTION_RETENTION.md；生产调度和全系统保留仍待交付 |
| M0-01 | DONE | 2026-11-10 | `AGENTS.md`、`docs/product/PRD.md`、`docs/design/DESIGN_SYSTEM.md`、`docs/architecture/TDD.md`、`docs/database/SCHEMA.md`、`docs/api/README.md`、`docs/architecture/decisions/ADR-001..006`、更新后的 `README.md` | 仅文档交付；未安装依赖、未初始化应用、未执行迁移或应用测试 |
| M0-01-R1 | DONE | 2026-11-10 | 1.1 契约与核心界面/端点、ADR-007/008；git diff --check、本地链接/锚点/表格/围栏、86 个对比度组合与范围检查；见 CONTRACT_REVIEW.md | 仅文档与静态检查；无应用/迁移/构建/真机验收，应用状态不变 |
| M0-02 | DONE | 2026-11-10 | workspace、`pnpm-lock.yaml`、Turbo、strict TS、ESLint/dependency-cruiser、Prettier、`.env.example`；`pnpm install --frozen-lockfile`、`format:check`、`lint`、`check:expo`、`typecheck` 通过；见 FOUNDATION_REPORT.md | 仅工具链与最小依赖；数据库、迁移与业务未实现 |
| M0-03 | IN_PROGRESS | 2026-11-10 | Web/API/Worker/Expo 骨架、共享 contracts/api-client/config/design-tokens、健康探针与 SSE 传输测试；`pnpm test` 48/48、`pnpm build` 11/11、`pnpm test:e2e` 6/6 通过 | 真机 Expo Go 连接、原生 SSE/取消探针与 development build 未执行，不能标记 DONE |
| M0-04 | DONE | 2026-11-11 | `infra/compose/compose.yaml`、`infra/postgres/init/00-roles.sh`、`scripts/infra.mjs`、`scripts/verify-infra.mjs`、`.env.example`；PostgreSQL 17.11/Redis 7.4.12 启动、20 项角色/认证/持久化检查通过；见 INFRASTRUCTURE.md | Compose 与角色已验证；应用连接池、迁移与 RLS 分别留给 M0-05/M0-06/M2，不能据此宣称数据库层完成 |
| M0-05 | DONE | 2026-11-11 | `packages/database`（Drizzle Schema、迁移 runner、seed、verify）、6 个迁移、`scripts/db-verify.mjs`；空库迁移、已有库升级、seed/迁移幂等、39 项 RLS/约束检查通过；见 MIGRATIONS.md | 仅 D1 表、异步样例表与只读/受控策略；认证写路径、FORCE RLS、D2–D6 与业务连接池未实现 |
| M0-06 | DONE | 2026-11-11 | `packages/service-health`、readiness 契约/客户端、API/Worker `/health/ready`、Web/Expo 探针、`scripts/check-readiness.mjs`；API 200、Redis 故障 503、Worker 消费者运行时就绪 200、48 项单测与 6 项 E2E 通过；见 READINESS.md | 就绪检查已验证；业务队列、限流、认证与生产编排未实现 |
| M0-07 | DONE | 2026-11-11 | `outbox_events`/`job_receipts`/样例表、`packages/domain`、Outbox 派发器、BullMQ Worker、`scripts/async-verify.ts`；29 项成功/重复/未知/死信/租约/崩溃/Redis 重启检查通过；见 ASYNC.md | 仅工程样例；业务队列、死信运维、指标与 exactly-once 未实现 |
| M0-08 | PARTIAL | 2026-11-11 | `.github/workflows/ci.yml`（verify + infrastructure）、`docs/development/SETUP.md`、`docs/development/DEPLOYMENT_INVESTIGATION.md`、README 实测命令；本地 format/lint/type/test/build/e2e/db/readiness/async 全部通过 | CI 工作流已定义但未在 GitHub Actions 实跑；部署/预算/校园网络仅为初查清单，无真实测量或报价 |
| M1-01 | DONE | 2026-11-11 | `packages/design-tokens` 语义/状态色、字体/行高/字重/字距、断点、深色主题、减少动态；Web/Expo 使用令牌；52 项测试、对比度矩阵与生成 CSS 检查通过；见 M1-01_TOKENS.md | 仅令牌层；组件、页面、双端高保真与真机字体缩放未验证 |
| M1-07 | REVIEW | 2026-11-11 | 可点击原型 `docs/design/prototypes/m1-07/index.html`、令牌快照、原型说明与 `M1-07_REVIEW.md`；覆盖 8 个页面、双身份、浅深色、状态切换、接受/发送/撤销对话框；Chrome 无头自检通过、移动端溢出 0 | 正式双端设计评审未进行；底栏标签、代表范围文案、撤销文案、关系用途流程等未决；不标记 DONE |
| M2-01 | DONE | 2026-11-11 | `0007_authentication.sql`、认证 contracts、`apps/api/src/auth/*`、`scripts/auth-verify.ts`、`AUTH.md`、ADR-009；42 项真实 HTTP/数据库/Redis 检查、59 项单测通过 | 认证闭环已验证；生产邮件、MFA、账号锁定、空闲超时、真实设备与 Web/Mobile 页面未实现 |
| M2-02 | DONE | 2026-11-11 | `0008_profile_and_campus.sql`、profile contracts、`apps/api/src/profile/*`、`scripts/profile-verify.ts`、`PROFILE.md`；16 项真实 HTTP/数据库检查、61 项单测通过 | 资料更新与校园申请已验证；校园审核、组织成员、FORCE RLS、真实设备与页面未实现 |
| M2-03 | DONE | 2026-11-11 | `0009_organizations.sql`、组织 contracts、`apps/api/src/organization/*`、`scripts/organization-verify.ts`、`ORGANIZATIONS.md`；31 项真实 HTTP/数据库检查、62 项单测通过 | 组织成员闭环已验证；所有权转让、审核、FORCE RLS、真实设备与页面未实现 |
| M2-04 | DONE | 2026-11-11 | `0010_force_rls.sql`、`M2-04_RLS.md`；18 张表 FORCE RLS、迁移角色例外、`row_security=off` 拒绝；63 项数据库检查通过 | 强制 RLS 已验证；RLS 性能/生产运维/直接写策略未实现 |
| M2-05 | DONE | 2026-11-11 | `scripts/isolation-verify.ts`、`M2-05_ISOLATION.md`；21 项跨账号/跨组织、伪造头、成员移除与连接池上下文检查通过 | 隔离验证通过；并发竞争、多实例与真实设备未验证 |
| M3-01 | DONE | 2026-11-11 | `0011_memory.sql`、记忆 contracts、`apps/api/src/memory/*`、`scripts/memory-verify.ts`、`MEMORIES.md`；27 项真实 HTTP/数据库检查、64 项单测、74 项数据库检查通过 | 手工确认记忆已验证；候选复核、生命周期清理、组织记忆、向量、共享与页面未实现 |
| M3-02 | DONE | 2026-11-11 | `0012_memory_review.sql`、候选/提取/确认/拒绝 contracts、`memory-extractor.ts`、候选/确认/拒绝/用途门 API、`scripts/memory-verify.ts` 扩展、`M3-02_MEMORY_REVIEW.md`；74 项真实 HTTP/数据库检查、71 项单测、92 项数据库检查通过 | 候选提取为确定性 Mock；批量复核、生命周期清理、真实 Provider、组织记忆、向量、共享与页面未实现 |
| M3-03 | DONE | 2026-11-11 | `0013_memory_lifecycle.sql`、`0014_memory_clock.sql`、事件 contracts、`GET /memories/:id/events`、`scripts/memory-maintenance.ts`、`M3-03_MEMORY_LIFECYCLE.md`；97 项真实 HTTP/数据库检查、72 项单测、110 项数据库检查通过 | 事件审计/到期/保留已验证；定时调度、语义索引清理、ConsentGrant 失效传播、组织记忆、共享与页面未实现 |
| M3-04 | DONE | 2026-11-11 | `packages/ai-core`、Provider/Mock/OpenAI-compatible 适配器、工具注册/执行/权限/超时/重试/审计、`scripts/ai-verify.ts`、`M3-04_AI_CORE.md`；28 项 AI 检查、103 项单测、19 项 typecheck 通过 | Provider/工具契约与 Mock 已验证；真实 Provider 网络、运行时 SSE、数据库审计落库与评估集未实现 |
| M3-05 | DONE | 2026-11-11 | `0015_agent_runtime.sql`、Agent contracts、`apps/api/src/agent/*`、`apps/worker/src/agent.ts`、Agent Outbox/队列、`scripts/agent-verify.ts`、`AGENT.md`、`M3-05_AGENT_RUNTIME.md`；45 项 Agent 检查、104 项单测、121 项数据库检查、29 项异步检查通过 | Mock Agent 运行时/SSE/取消/来源复核已验证；真实 Provider、代理/原生流、Worker 崩溃恢复、行动确认与页面未实现 |
| M3-06 | DONE | 2026-11-11 | `0016_actions.sql`、`0017_actions_fix.sql`、Action contracts、`apps/api/src/action/*`、`scripts/action-verify.ts`、`ACTIONS.md`、`M3-06_ACTIONS.md`；33 项行动检查、105 项单测、128 项数据库检查通过 | `memory.create` 行动确认框架已验证；真实高影响行动、Agent 自动提议、失败重试、过期扫描与页面未实现 |
| M3-07 | PARTIAL | 2026-11-11 | `packages/ai-core/src/eval/*`、脱敏评估集 `2026-11-11.1`、共享匹配/提示构建、`scripts/ai-eval.ts`、`ai:eval`、CI 评估门、`M3-07_EVALUATION.md`；10/10 用例与阈值通过、124 项单测、20 项 typecheck、12 项构建通过 | 评估、预算与报告已验证；个人页面/记忆复核 UI 受 M1-07 设计评审门阻塞，真实 Provider 评估、费用校准与数据库回归未执行 |
| M4-01 | DONE | 2026-11-11 | `0018_opportunities.sql`（`update_organization`、`get_public_organization`）、`PATCH /organizations/:id`、`GET /organizations/:id/public`、`docs/api/ORGANIZATIONS.md`；`pnpm opportunity:verify` 通过 | 组织资料更新、所有权/管理权鉴权与公开端点已验证；组织认证审核流待后续完善 |
| M4-02 | DONE | 2026-11-11 | `0018_opportunities.sql`（`opportunities` 表、FORCE RLS、11 个存储函数）、contracts、API 机会模块、`scripts/opportunity-verify.ts`、`scripts/opportunity-maintenance.ts`、`docs/api/OPPORTUNITIES.md`；24 项真实端到端检查、125 项单测、18/18 迁移通过 | 机会草稿/发布/暂停/关闭终态、乐观锁版本并发保护、同校与全网可见性隔离、到期动态处理与定时维护通过 |
| M4-03 | PARTIAL | 2026-11-11 | `apps/web/src/app/organizations/[id]` 控制台页面、Overview、机会管理、成员列表、收件箱占位；完整 loading/error/denied 状态矩阵；Turbo build 通过 | 组织 Web 控制台界面与状态矩阵已交付 |
| M4-04 | DONE | 2026-11-11 | 迁移 `0019`–`0021`、Worker 隔离加载、`organization_context.search`、`opportunity_draft.create`、`app.confirm_opportunity_create_action`；`pnpm org:verify` 通过 | 组织 Agent 范围检索与机会草稿行动确认已验证 |
| M4-05 | DONE | 2026-11-11 | `scripts/organization-action-verify.ts`、`pnpm org:verify`；25 项非成员越权拦截、旧草稿确认阻断、私有资料防泄漏与 FORCE RLS 测试全绿 | 组织安全边界与行动审计已验证 |
| M5-01 | DONE | 2026-11-11 | `0022_intents_and_matching.sql`、`intents` 表与 FORCE RLS、`apps/api/src/intent/*`、`/api/v1/intents`；`pnpm m5:verify` 通过 | 个人意向创建、更新、状态机与乐观锁并发控制已验证 |
| M5-02 | PARTIAL | 2026-11-11 | `0022_intents_and_matching.sql`、`match_candidates` 表、`app.generate_match_candidates`；计算特征分与结构化证据原因（`reasons`、`featureScores`）；`pnpm m5:verify` 通过 | 可解释匹配推荐与候选隔离已验证；**向量语义召回未实现**（仓库无 pgvector 列与 embedding 表，`v1` 为确定性特征打分） |
| M5-03 | DONE | 2026-11-11 | `0023_consent_and_referrals.sql`、`consent_previews` 表、`POST /api/v1/consents/previews`、短期到期与 payload hash 快照；`pnpm m5:verify` 通过 | 用途受限授权预览已验证 |
| M5-04 | PARTIAL | 2026-11-11 | `0023_consent_and_referrals.sql`、`referrals`、`referral_decisions`、`consent_grants`、`consent_grant_items`、`consent_events`；`POST /api/v1/referrals`、`/decisions`；`pnpm m5:verify` 通过 | 双方双向接受决定状态机与用途绑定已验证；2026-11-12 复核：补充资料接口未实现，整包为 PARTIAL |
| M5-05 | DONE | 2026-11-11 | `0024_relationships_and_sharing.sql`、`relationships`、`relationship_members`、`app.establish_relationship`、`POST /api/v1/relationships`；`pnpm m5:verify` 通过 | 接受后原子建联与唯一性事务约束已验证 |
| M5-06 | PARTIAL | 2026-11-11 | `0024_relationships_and_sharing.sql`、`shared_context_items`、`GET /api/v1/relationships/:id/context`；`pnpm m5:verify` 通过 | 关系空间成员权限与关系用途快照受控读取已验证；2026-11-12 复核：会话/消息 API 未实现，整包为 PARTIAL |
| M5-07 | DONE | 2026-11-11 | `0023_consent_and_referrals.sql`、`POST /api/v1/consents/grants/:id/revoke`、`app.get_relationship_shared_context` 实时阻断；`pnpm m5:verify` 通过 | 授权撤销实时失效与下游共享即时阻断已验证 |
| M5-09 | REVIEW | 2026-11-11 | `scripts/m5-journey-verify.ts`、`pnpm m5:verify`、`packages/database/src/verify.ts`（24 项迁移，42 表 FORCE RLS）；全流程无 Mock 真实端到端通过 | 后端确定性闭环已验证；产品 Web/Android 旅程仍待验收 |
| M6-01 | DONE | 2026-11-11 | `0025_calendar_and_availability.sql`、`availability_blocks` 表与 FORCE RLS、`app.upsert_availability_block`、`app.query_availability_window`；`/api/v1/availability/*`；`pnpm m6:verify` 通过 | 个人日程与忙闲块录入、列表与隐私投影已验证；投影严格过滤敏感字段（无标题、无描述、无私密备注） |
| M6-02 | PARTIAL | 2026-11-11 | `0025_calendar_and_availability.sql`、`calendar_connections` 表与 FORCE RLS、凭据加密隔离与同步游标架构 | 仅数据底座；真实 OAuth、连接器凭据写入与同步恢复未验证（2026-11-12 复核） |
| M6-03 | DONE | 2026-11-11 | `packages/domain/src/time-intersection.ts`、确定性多方忙碌区间合并与空闲槽位求解纯函数算法、6 项全景单测、`POST /api/v1/availability/intersection`；`pnpm m6:verify` 通过 | 多方时间求交算法与工作时段过滤已验证 |
| M6-04 | DONE | 2026-11-11 | `0026_events_and_coordination.sql`、`events`、`event_proposals`、`event_participants` 表与 FORCE RLS、`app.can_view_event` 鉴权、`/api/v1/events/*`；`pnpm m6:verify` 通过 | 活动草稿、提案提议、参与者响应、全员接受自动转 confirmed 终态及取消流转已验证 |
| M6-01R | DONE | 2026-11-11 | `0029_availability_sharing.sql`（`app.create_availability_share`、`app.list_availability_shares`、`app.revoke_availability_share` 与带授权判定的 `app.query_availability_window`）、`POST/GET/DELETE /api/v1/availability/shares`、ADR-010；`pnpm m6:verify` 30/30、`pnpm db:verify` 184 项通过 | 忙闲用途授权共享已验证：默认拒绝、单向授权、期限上限 90 天、撤销后立即阻断、投影不含私人字段 |
| M5-08 | NOT_STARTED | 2026-11-11 | 无 | Android development build 主线未开始：当前无 Android SDK，`apps/mobile` 仅有首页骨架 |
| M6-05 | NOT_STARTED | 2026-11-11 | 无 | AI 活动约束提取与协调求解未实现 |
| M6-06 | PARTIAL | 2026-11-12 | 0034、通知 API/Worker/客户端、NOTIFICATIONS.md | 个人连接站内通知已交付；活动通知、移动推送、产品 UI 与生产运维尚缺 |
| M6-06A | PARTIAL | 2026-11-12 | A1 个人连接站内通知已交付 | A2 活动通知尚未实现；不据此关闭整个 M6-06 |
| M6-06A1 | DONE（个人连接通知后端） | 2026-11-12 | 0034、4 张 FORCE RLS 表、通知 API/客户端/Worker、notifications:verify | 本轮执行结果见 NOTIFICATIONS.md；只有个人连接站内链路，无 UI/推送 |

2026-11-11 安全核对：原 `app.query_availability_window` 只检查调用者已登录，未校验被查询主体授权，跨用户忙闲数据存在越权读取风险。新增迁移 `0027_availability_privacy`，临时只允许本人查询；多人求交在用途授权机制实现前不可用。**修复已在 2026-11-11 后续轮次完成**：迁移 `0029_availability_sharing` 落地显式用途授权（忙闲所有者创建带期限的共享授权，撤销后立即阻断），本机已应用 `0027`–`0029` 并复验 `pnpm m6:verify` 30/30、`pnpm db:verify` 184 项、`pnpm m5:verify` 21/21、`pnpm isolation:verify` 21/21。未应用迁移的数据库仍受影响，不能用于真实数据。详见 [M6 交付记录](M6_CALENDAR_EVENT.md) 与 [ADR-010](../architecture/decisions/0010-availability-authorization.md)。

M4–M6 的上述 DONE 记录只反映当时记录的实现和检查，不代表阶段验收全部满足：正式双端设计评审、Android 主线、真实 Provider、外部日历连接和其他验收条件仍待完成。M6-05（AI 活动约束提取与协调）、M6-06 的活动通知/移动推送/UI 仍待实现；个人连接站内通知只关闭 A1 后端范围。


### AI 用户自配进展（2026-11-11）

用户要求自行配置 AI 服务。现有 Provider 配置是服务级环境变量，用户级配置和密钥保管尚未实现；上线前须完成隔离、外部地址访问控制、数据发送范围和真实服务验证。本轮修复 OpenAI-compatible 流提前断开时错误标记成功、估算总 token 低报，并用本地模拟流验证完成标志、异常、usage 和估算；不等同真实 Provider 验收。

### AI 用户配置管理（2026-11-11，部分完成）

新增 `0028_user_ai_provider.sql`、用户配置 GET/PUT/DELETE API，用户密钥 AES-256-GCM 加密、读接口仅返回元数据，更新/删除通过版本检查；服务端设置存储密钥与 HTTPS URL 精确允许列表。隔离数据库执行空库/升级迁移、seed 和迁移幂等，验证身份、跨用户隔离、密文表禁止直接读取和版本冲突；加密及 URL 规则有单元测试。尚未接入 Worker、前端、密钥轮换、真实服务和真实数据发送授权，不能作为完整自配 AI 功能。**运行数据库已于 2026-11-11 应用 `0028`。**

### 文档与交付记录补齐（2026-11-11）

新增 [M4 交付记录](M4_ORGANIZATION.md)、[M5 交付记录](M5_MATCHING_RELATIONSHIP.md)、[M6 交付记录](M6_CALENDAR_EVENT.md)；新增端点契约 [MATCHING.md](../api/MATCHING.md)、[REFERRALS.md](../api/REFERRALS.md)、[RELATIONSHIPS.md](../api/RELATIONSHIPS.md)、[AVAILABILITY_EVENTS.md](../api/AVAILABILITY_EVENTS.md)；新增 [ADR-010 忙闲用途授权](../architecture/decisions/0010-availability-authorization.md)。README 与 AGENTS.md 的阶段描述同步到 M6 实际状态，并明确 M5-02、M5-08、M6-02、M6-05、M6-06 与 UI 层仍未完成。
