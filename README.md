# AVEN

AVEN 是面向个人与组织的 AI 连接网络，首个试点场景为西安交通大学。产品围绕个人上下文、组织资源、经授权的机会匹配，以及真实合作与活动协调展开。

2026-11-13 **注册故障修复**：纠正重复邮箱的授权变化误报，提供登录/找回密码入口；账号创建后邮件失败返回明确状态，未验证账号凭原密码可重发且不覆盖资料。352 项单测、10 项注册和 11 项恢复检查通过，线上 API/Web 已更新。详见 [注册修复](docs/development/WEB_REGISTRATION_FIX.md)。

2026-11-13 **欢迎入口与闪烁修复**：按最新 Grok Bot 截图重新设计欢迎页与按需认证面板；匿名会话复核不卸载表单，保留输入并合并重复请求。参考 Socrates 接入 SMTP 与一次性密码恢复链接。单测 348 项、恢复 HTTP/数据库 11 项、线上多尺寸与输入保留回验通过。SMTP 已通过 TLS/账号认证，实际收信仍待真实邮箱确认。详见 [WEB_LOGIN_02](docs/development/WEB_LOGIN_02.md)。APK 继续暂停。

2026-11-13 **认证界面视觉调整**：按用户三张深色参考图统一登录/注册/恢复页面，纯色画布、白色正圆角色、胶囊输入与更清晰留白，移出工程入口并新增密码可见切换。线上已更新，真实注册/登录/退出与三种视口检查通过，见 [视觉 QA](design-qa.md)。用户要求先暂停 APK，远端构建已取消，工作流仅保留手动触发。

本机开发验证版已部署：[aven.topodrive.top](https://aven.topodrive.top)。默认 Mock，非生产试点；运行方式与 TLS 限制见 [部署记录](docs/development/DEPLOYMENT.md)。

2026-11-13 **WEB/ANDROID-01 个人工作区开发**：按 ADR-018 补齐 Web 资料/设备会话/密码恢复、个人运行历史、行动确认与拉黑举报；Android 新增原生登录、Mock SSE、记忆复核、个人连接与消息、通知偏好、连接器卡片和账号设置，令牌使用 SecureStore。Android APK 按用户要求由 [GitHub Actions](.github/workflows/android-apk.yml) 构建，本机只执行 JS/工程检查。本机工程检查与 333 项单测通过，公网账号 15 项及安全/行动/隔离 18 项复验通过。当前仍待远端 APK 和设备验收，不代表完整 MVP 可发布。范围、检查与缺口见 [交付记录](docs/development/WEB_ANDROID_01.md)。

2026-11-13 **WEB-03 连接器与会话小组件接入**：个人 Web 对话输入区新增连接器入口，按类别展示服务端目录的 11 个内置连接器与凭据状态，按动作动态生成表单并以 Mock 模式调用，结果以 12 种声明式小组件卡片渲染进对话流，外部跳转需二次确认。新增 Web 端纯函数单测（vitest 范围扩到 `apps/web/src`）。未接入真实开放平台凭据、真实 MCP 传输或第三方账号。实际验证：单测 313 项、连接器复验 8 项、WEB-01/02 回归 30 项通过；`check:expo` 仍失败。详见 [交付记录](docs/development/WEB_03.md)。

2026-11-13 **WEB-02 候选记忆复核与通知偏好**：个人 Web「记忆与上下文」新增候选复核标签页（服务端规则提取 `mock_rules_v1`、逐条编辑/确认/拒绝、用途默认拒绝），已确认信息可原位编辑与二次确认撤回；通知面板新增通知偏好开关（`expectedVersion` 乐观锁，冲突回读）。共享客户端新增记忆复核方法并首次支持 `PATCH`。无迁移、无服务端改动，未接入真实 Provider/OAuth/原生端。实际验证：单测 308 项、个人 Web 复验 12 项、WEB-01 回归 18 项、恢复 7 项通过；`check:expo` 仍失败。详见 [交付记录](docs/development/WEB_02.md)。

2026-11-12 **当前状态复核**：本机 PostgreSQL/Redis 均 healthy；只读检查确认开发库已应用 38/39 个迁移，0039 日历连接迁移仍为 pending，既有迁移校验和一致，61 张租户表 FORCE RLS。最新聊天/连接器稿与圆形角色动效仍为设计资产，未接入正式产品页面；相关改动尚未提交 Git。此次未执行迁移或业务集成回归，详见 [系统状态](docs/development/SYSTEM_STATUS.md)。

2026-11-12 **圆形角色动效稿**：基于用户要求的“无手脚、标准正圆、两只胶囊眼睛”，增加呼吸、眨眼、好奇、开心、思考、惊喜、困倦和招呼 8 种可切换动效、眼神跟随与暂停/轮播；交付 8 个独立动态 SVG 和静态 SVG。浏览器检查 69 项通过，含变换矩阵正圆校验与系统减少动态；仅设计资产，未接入产品或真实 Agent 状态。见 [交互动效稿](docs/design/prototypes/mascot-motion/index.html) 与 [说明](docs/design/prototypes/mascot-motion/README.md)。

2026-11-12 **M1-07 v0.4 图片对齐**：按用户提供的 Gmail / Outlook 手机截图重做会话与连接器视觉，默认浅色、灰色回复气泡/黑色用户气泡、28px 连接器卡、胶囊输入栏与按钮，并统一 SVG 内外圆角、压缩间距。新增双款邮箱授权卡与明确确认/取消/断开的模拟交互；五个宽度共 557 次原型断言通过。仅设计原型，未接入真实 OAuth 或邮箱，正式产品 UI 与设计评审门不变。见 [原型](docs/design/prototypes/m1-07-v3/index.html) 与 [检查记录](docs/design/prototypes/m1-07-v3/design-qa.md)。

2026-11-12 **M1-07 v0.3.1 交互打磨**：沿用对话优先、精致圆角与无光影设计，完善输入草稿保留、多行高度、空白/离线禁发、失败重试、阅读位置保留、键盘导航与模态面板；共享预览增加字段计数，接收方离线隐藏授权资料。五个宽度原型检查与新增交互检查共 412 次断言通过，另完成桌面/手机键盘流程检查。仅为设计原型，正式双端评审仍为 REVIEW，未进入产品 UI 编码或接入真实业务。见 [评审稿](docs/design/prototypes/m1-07-v3/index.html) 与 [检查记录](docs/design/prototypes/m1-07-v3/design-qa.md)。

2026-11-12 新增 **P2P-02 共享客户端与小组件读取协议**：Web Cookie/CSRF 与移动 Bearer 的逐次认证、类型化个人连接读写、当前会话角色与授权快照聚合读取；正文不缓存、写入不自动重试。真实 HTTP/数据库检查 71 项、单测 179 项通过。尚未把小组件接入产品聊天界面，详见 [交付记录](docs/development/CONNECTION_CLIENT_WIDGET.md)。

2026-11-12 本轮完成 **P2P-03 个人连接正文保留清理**：预览过期满 24 小时、共享正文失效满 30 天后受控清除；保留邀请/连接/幂等元数据，并修复来源到期后延长可能恢复旧共享的边界。已应用 0033，旧数据升级、开发/隔离库各 37 项清理检查、74 项连接 HTTP 检查、188 项单测及构建/类型/lint 通过。显式维护已验证，生产定时调度尚未交付。见 [本轮记录](docs/development/CONNECTION_RETENTION.md)。

系统仍未完成。已按代码重新核对 [系统缺口与推进顺序](docs/development/SYSTEM_STATUS.md)，并纠正开发计划中过满的 DONE：产品 UI/正式设计评审、活动通知/移动推送、共同会话、真实 AI、向量召回、真实日历、原生验收和运行保障仍待完成；不能把后端接口和原型当作完整应用。

2026-11-12 新增 **M5-04 引荐补充资料、内容版本化与超期维护**：交付引荐补充资料提交（`POST /api/v1/referrals/:id/supplements`）与参与方列表查询（`GET /api/v1/referrals/:id/supplements`），提交自动递增 `content_version` 并重置组织决定为 `pending` 重新审核；交付 Worker 专属批量超期维护存储过程 `app.maintain_referrals`；已应用 0038 迁移，38 个迁移、61 张租户表（全部 FORCE RLS），`supplements:verify` 25/25 通过。详见 [本轮交付](docs/development/REFERRAL_SUPPLEMENTS.md)。

2026-11-12 新增 **P2P-04 个人连接会话消息与保留清理**：基于已建立的独立个人连接（`peer_connections`），交付点对点私聊消息收发（`POST /api/v1/connections/:id/messages`）、幂等去重与防冲突（`clientMessageId`）、时间倒序键集游标分页（`GET /api/v1/connections/:id/messages`）、单方软删除隐藏与双方均软删除后的 Worker 物理正文清除（`purged_at`）。隔离库与开发库通过 31 项全链路检查；36 个迁移、58 张租户表全部 FORCE RLS。单测 217 项通过。**没有聊天 UI 或移动推送**，仍非完整跨终端产品。详见 [本轮交付](docs/development/PEER_MESSAGES.md) 与 [API 契约](docs/api/PEER_MESSAGES.md)。

2026-11-12 新增 **M6-06A2 活动协调站内通知后端**（连同 M6-06A1 个人连接通知实现站内通知闭环）：个人连接邀请/接受/拒绝/撤回/撤销与活动提案/确认/取消的同事务 Outbox、真实 BullMQ 消费、当前业务/偏好过滤、分页/已读、去重与失败重试、平台管理员死信重排，以及 90 天收件箱清理。隔离库与开发库各 62 项连接通知检查、18 项活动通知检查、203 项单测通过；35 个迁移、57 张租户表 FORCE RLS。**没有通知 UI 或移动推送**，仍非完整跨终端产品。见 [本轮交付](docs/development/NOTIFICATIONS.md) 与 [API 契约](docs/api/NOTIFICATIONS.md)。

## 安全核对进展

2026-11-11 核对发现，原忙闲投影允许已登录用户查询其他主体，缺少用途授权。修复分两步：迁移 `0027_availability_privacy` 先把查询收紧为仅本人（fail closed）；迁移 `0029_availability_sharing` 补上显式用途授权——忙闲所有者创建带期限（最长 90 天）的共享授权（用途 `event_coordination`），被授权方可读取忙闲投影，撤销后立即阻断。授权是单向的，不共享标题与备注等私人字段。决策见 [ADR-010](docs/architecture/decisions/0010-availability-authorization.md)。

新迁移必须应用到对应数据库后才生效，未迁移的运行环境仍有风险。本机已应用 `0027`–`0029` 并复验：`m6:verify` 30/30、`db:verify` 184 项、`m5:verify` 21/21、`isolation:verify` 21/21 全部通过。

M4–M6 的实现与执行记录不等于双端设计评审、真实 Provider、设备验收或 MVP 已完成。请同时查阅[开发计划](docs/development/DEVELOPMENT_PLAN.md)与 [M4](docs/development/M4_ORGANIZATION.md)、[M5](docs/development/M5_MATCHING_RELATIONSHIP.md)、[M6](docs/development/M6_CALENDAR_EVENT.md) 交付记录。

## AI 配置进展

用户希望自行配置 AI 服务。当前已增加用户级模型配置管理 API，密钥加密保存、读取不返回密钥，支持按版本更新与删除；用户设置尚未接入 Worker，界面也未实现，因此不能用于用户自配模型对话。服务端使用显式 HTTPS 地址允许列表；调用前仍需连接时网络安全检查、发送范围确认和真实服务验证。流式适配器已修正提前断流误报成功及估算 token 总量的问题，相关验证使用本地模拟响应。

## 当前状态

2026-11-12 **WEB-01 个人 Web 限定接入**：首页现为注册/登录与 Mock SSE 对话，接入手工记忆、用途预览后的个人邀请、已有连接消息和站内通知。正圆角色随状态变化，沿用 v0.4 圆角与紧凑布局。详见 [交付与验证](docs/development/WEB_PERSONAL.md)、[ADR-017](docs/architecture/decisions/0017-personal-web-increment.md)。这是用户授权的首批 Web 实现，M1-07 整体仍 REVIEW；真实模型、外部邮箱、原生端和完整组件层仍未完成。下方历史记录按各自交付日期和限定范围理解。

2026-11-12 新增 **P2P-01 个人连接邀请后端**：已确认记忆的用途授权预览、幂等发送、接收方独立接受/拒绝、原子唯一建联、撤回与撤销即时阻断。隔离数据库与本地开发库各通过 53 项真实 HTTP/数据库检查；迁移已推进到 0032。接收通过登录后的列表读取，**没有通知、真实 AI 推荐、共同消息或产品小组件接入**，不是完整跨终端应用。详见 [个人连接交付记录](docs/development/PERSONAL_CONNECTIONS.md) 与 [API 契约](docs/api/CONNECTIONS.md)。

2026-11-12 最新产品方向与设计稿：[AVEN v0.3 对话与连接](docs/design/prototypes/m1-07-v3/index.html)。依据用户反馈，改为对话优先，连接建议、共享预览和双方回应以会话小组件呈现，插件从输入区按需调用；复用 Socrates 的字体和成熟 UI，并采用精致圆角、无光影设计。前轮 v0.2 的业务导航方案已被替代。v0.3 已做五个宽度的原型自检，仍为 REVIEW；两端连接和插件均是设计模拟，尚未接入真实个人到个人服务。

2026-11-12 产品界面设计新增 [M1-07 v0.2 可点击原型](docs/design/prototypes/m1-07-v2/index.html)：参考用户提供的 ChatGPT 深色截图，覆盖核心旅程与 AI/记忆/设置共 11 个视图，支持桌面侧栏、手机四项底栏、头像菜单、用途独立授权与撤销。五个宽度的原型交互/回流自检通过，详见 [设计自检](docs/design/prototypes/m1-07-v2/design-qa.md)。**仍为 REVIEW**：正式产品与工程双端评审未完成，没有进入产品 UI 编码或接入真实业务。

后端业务闭环已推进到 **M6 日程与活动**。已实现并通过真实 HTTP/数据库验证：

- **M0 工程基础**：workspace、Compose/PostgreSQL/Redis、迁移与 seed、就绪探针、Outbox/BullMQ、CI 工作流（**整套 CI 尚无通过记录；本轮 Android APK 工作流已开始实跑**）。
- **M1 设计**：令牌层（M1-01）、可点击原型（M1-07，**正式双端评审未做**）及 ADR-017 限定个人 Web；M1-02–M1-06 仍为部分实现。
- **M2 身份与组织**：认证会话、资料/校园、组织成员与邀请、强制 RLS、跨账号/跨组织隔离。
- **M3 个人上下文与 AI**：记忆、复核、生命周期、Provider 与工具、Agent 运行时/SSE、行动确认；M3-07 已有评估集/预算门和首批个人 Web，**候选记忆复核与完整个人页面仍未完成**。
- **M4 组织与机会**：组织资料、机会生命周期、组织控制台页面、组织 Agent 与边界测试。
- **M5 匹配·引荐·关系**：意向与可解释候选、用途授权预览、引荐双向决定、原子建联、关系共享上下文、撤销即时阻断；**M5-02 的向量语义召回未实现**（当前为确定性特征打分），**M5-08 Android 个人工作区已编码，APK 与真机主线待验收**。
- **M6 日程与活动**：忙闲块、忙闲投影与用途授权共享、多方时间求交、活动状态机、站内通知后端闭环（个人连接与活动协调）、个人会话消息（P2P-04）、个人拉黑与举报治理；**M6-02 外部日历 OAuth 连接底座已交付凭据 AES-256-GCM 加密隔离、HMAC state/callback、同步游标、过期游标回退恢复、原子撤回、`0039` 迁移与 `/api/v1/availability/connections*` 端点及共享客户端（`MockCalendarOAuthAdapter` 默认，真实 OAuth 密钥与 `db:verify` 实库验证待环境补验）**；**M6-05 AI 协调已交付 Mock 默认约束提取与按参与者当地 IANA 时区（含夏令时）求解接口（`POST /api/v1/events/coordinate`）并完成单测/类型/构建检查，真实 AI Provider 与实时库 `m6:verify` 复跑待环境补验**；M6-06 已接入首批 Web 站内通知 UI，移动推送未实现。
- 确定性基础求交工作时段仍固定为 UTC 09:00–18:00，单次最多 50 个主体、31 天；`POST /api/v1/events/coordinate` 已支持按参与者各自的 IANA 时区计算当地工作时段与夏令时偏移。

尚未完成：完整个人页面与移动端 UI（`apps/mobile` 仅有骨架）、M7 运行保障与试点、真实 Provider/邮件/日历的真实服务验证、原生真机验收、双端设计评审、语义向量召回、移动推送。M0 与 MVP 均未完成。

首页为个人 Web 开发验证版，工程诊断迁至 `/diagnostics`。组织控制台入口使用开发组织 ID，须有有效会话和组织权限；入口不代表产品界面已验收。当前 `check:expo` 报告部分依赖低于 Expo 推荐兼容版本，尚待升级和复验。

2026-11-11 本轮完成 M6 求交可靠性补验：无效忙闲区间不再被当作空闲，补充 HTTP 输入上限和 UTC 工作时段检查。单元测试 162/162、M6 真实 HTTP/数据库检查 37/37、诊断页 E2E 6/6，以及格式、lint、类型与构建通过。Expo 推荐补丁安装被仓库的 12 小时发布等待期拒绝，依赖清单与 lockfile 未改动，`check:expo` 仍失败。具体范围、命令与后续任务见 [求交可靠性交付记录](docs/development/M6_RELIABILITY.md)。

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
| [插件与功能小组件 API](docs/api/PLUGINS_WIDGETS.md) | 可扩展插件注册表、11 个内置连接器（高德/淘宝/京东/闪购/美团/Gmail/QQ邮箱/社交/日程/天气/比价）、自定义 MCP 与 12 种会话小组件协议 |
| [关系空间 API](docs/api/RELATIONSHIPS.md) | 关系建立、共享上下文、关闭与唯一性 |
| [个人连接 API](docs/api/CONNECTIONS.md) | 个人邀请、预览、双方决定、独立授权与唯一建联 |
| [会话消息 API](docs/api/PEER_MESSAGES.md) | 消息收发、时间倒序游标分页与单方软删除契约 |
| [个人拉黑与举报 API](docs/api/BLOCKS_AND_REPORTS.md) | 个人拉黑、解除、违规举报与 24 小时限流契约 |
| [P2P-04 消息交付记录](docs/development/PEER_MESSAGES.md) | 消息收发、倒序游标、软删除与双删物理保留清理 |
| [WEB-01 个人 Web 交付记录](docs/development/WEB_PERSONAL.md) | 个人 Web 首批真实接入：登录、Mock 对话、记忆、连接、消息与通知 |
| [WEB-02 记忆复核与通知偏好](docs/development/WEB_02.md) | 候选复核、记忆编辑撤回、通知偏好与共享客户端扩展 |
| [WEB-03 连接器与会话小组件](docs/development/WEB_03.md) | 连接器目录、动态表单、12 种会话小组件渲染与外部跳转确认 |
| [安全与试点准入交付记录](docs/development/BLOCKS_AND_REPORTS.md) | 个人拉黑、举报、24h 邀请频控与双向阻断验证 |
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

下一项是补齐个人 Web 的候选记忆复核与会话小组件，并继续 **M1-07 正式双端设计评审**；首批限定 Web 依据 ADR-017 接入，不能替代其余页面与原生端的验收；向量召回按模型/维度门独立推进，真实 Provider 仍受数据发送与验证门约束。真实 Provider 评估、M0-03 的 Expo Go 真机连接与 M0-08 的 GitHub Actions 实跑仍待环境；CI 工作流已定义、本地命令已通过，但不能宣称 CI 已绿。

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
corepack pnpm connections:verify # 个人连接与小组件读取的 HTTP/数据库验证
corepack pnpm connections:verify:retention # 正文保留、并发维护与权限边界验证
corepack pnpm connections:maintain # 显式维护一次；不是生产定时调度
corepack pnpm notifications:verify # 个人连接站内通知：真实 HTTP/数据库/队列
corepack pnpm notifications:maintain # 显式清除 90 天前的站内通知，保留去重回执
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
