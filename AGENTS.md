# AGENTS.md — AVEN 工程协作规则

本文件适用于所有在本仓库工作的 AI Agent 和人类开发者。开始修改代码前必须阅读。

## 1. 当前阶段

- 当前只完成 **M0-01：最小产品与工程文档**。
- 仓库尚无应用代码、依赖清单、数据库迁移、CI 或可运行脚本。
- 不要把规划、文档、脚手架、Mock 或开发数据描述为功能完成。
- 下一项任务是 **M0-02：依赖与运行时**，随后 M0-03 应用骨架。
- 任何状态变更以实际代码、命令输出和验证结果为依据，并同步更新 README 和开发计划执行记录。

## 2. 必读顺序

修改代码前按顺序阅读：

1. `README.md`
2. `AGENTS.md`（本文件）
3. `docs/product/PRD.md`
4. `docs/design/DESIGN_SYSTEM.md`
5. `docs/architecture/TDD.md`
6. `docs/database/SCHEMA.md`
7. `docs/api/` 中与任务相关的端点契约
8. `docs/architecture/decisions/` 中与任务相关的 ADR
9. 相关模块的现有代码、测试和迁移

不要在没有检查现有实现的情况下重新搭建项目。

## 3. 文档优先级

- `Origin Plan.md` 是原始需求来源，保留原文和 PAN 代号。
- `PRD`、`TDD`、`SCHEMA`、`DESIGN_SYSTEM` 是实现契约，统一使用 AVEN。
- 如果实现需要偏离契约，先更新文档并说明原因，再改代码。
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
| `packages/domain` | 框架无关领域服务（M0-07 验证后创建） | 依赖 Nest/HTTP/React |
| `packages/api-client` | HTTP/SSE 客户端 | 混入 UI 状态 |
| `packages/design-tokens` | 设计令牌 | 依赖应用代码 |
| `packages/ai-core` | Provider/工具契约（M3） | 直接访问数据库 |
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
- 普通请求使用 `aven_app` 角色；不能绕过 RLS；事务内设置 actor 上下文。
- 授权读取检查 grant 状态、用途、字段、有效期和接收主体；撤销后立即拒绝新读取。
- 共享只读授权快照，不直接连接私人记忆。
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
- [ ] 交付说明包含文件变化、架构、数据库、API、测试、已知问题和后续任务。

未执行的检查不能标为通过；不能用空脚本显示绿色。

## 9. Git 与 PR

- 默认从 `main` 建分支，命名：`feat/...`、`fix/...`、`docs/...`、`chore/...`。
- 每个 PR 是一个可审查、可验证的单位；范围大时拆为契约、实现、界面，但不留下可误执行的半成品。
- 提交信息用英文，建议 `type(scope): summary`。
- PR 描述必须包含：变更文件、架构影响、数据库/API 变化、测试命令与结果、已知问题、后续任务。
- 不在 PR 中提交真实密钥、私人数据、生成物或本地环境文件。
- CI 未通过不合并；未实现的检查不能放空。

## 10. 当前禁止

在 M0-02 开始前：

- 不创建 `package.json`、应用骨架或依赖 lockfile。
- 不安装依赖、不初始化数据库、不运行迁移。
- 不声称 Web/API/Worker/Expo 可启动。
- 不接入真实 AI Provider。
- 不开始 Android 原生实现（当前无 Android SDK；开发期用真机 Expo Go，M5 再接入主线）。

## 11. 语言与沟通

- 产品/工程文档用中文；代码、标识符、提交信息和 API 字段用英文。
- 中英文之间保留空格；专有名词大小写一致。
- 交付说明简洁、具体，区分“已完成”“已验证”“计划中”“未实现”。
- 遇到阻塞记录原因、影响和下一步，不把阻塞写成完成。

## 12. 常用命令

M0-02 之前不存在可执行的项目脚本。不要编造 `pnpm dev`、`pnpm test` 等命令；M0-02/M0-03 完成并实际验证后，在本节和 README 中补充。

当前可用的环境检查：

```bash
node -v
corepack --version
docker --version
psql --version
```
