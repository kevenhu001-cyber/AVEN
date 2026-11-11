# M3-04 Provider 与工具

日期：2026-11-11 · 状态：Provider 抽象、Mock Provider、OpenAI-compatible 适配器契约、工具注册/执行/权限/超时/重试/审计已实现并通过单元与脚本验证；真实 Provider 网络、运行时 SSE、数据库审计落库与评估集未实现

## 范围

本轮建立 `@aven/ai-core`：统一 Provider 接口（文本、结构化输出、流式、Embedding）、显式 Mock Provider、OpenAI-compatible 适配器、工具定义/注册表/执行器、权限与数据用途检查、超时、重试上限、结果校验和 metadata-only 审计。OpenAI-compatible 适配器只使用注入的 `fetch` 与本地假响应验证，不连接真实服务、不读取真实密钥。未实现 M3-05 的 run/SSE 运行时、M3-06 的行动确认、M3-07 的评估集与页面。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/ai-core/src/provider.ts` | Provider 接口、消息/用途/usage/流事件类型与输入校验 |
| `packages/ai-core/src/mock-provider.ts` | 确定性 Mock 文本/结构化/流式/Embedding，`mock: true` 明示 |
| `packages/ai-core/src/openai-compatible-provider.ts` | 注入 `fetch` 的 OpenAI-compatible 适配器；HTTP 错误、超时、取消、结构化校验、SSE 解析 |
| `packages/ai-core/src/provider-config.ts` | Mock/OpenAI-compatible 配置 Schema、环境变量解析与工厂 |
| `packages/ai-core/src/tools.ts` | 工具定义、注册表、模型安全描述、权限/用途/审计类型 |
| `packages/ai-core/src/tool-executor.ts` | 权限/用途前置检查、Zod 参数/结果校验、超时、幂等重试、审计 |
| `packages/ai-core/src/tools/memory-search.ts` | `memory.search` 示例工具：`memory:read:self` + `self_ai` 用途 |
| `packages/contracts/src/index.ts` | `ToolPermissionSchema` 与 `TOOL_PERMISSIONS` |
| `scripts/ai-verify.ts` | 28 项 Provider/工具端到端检查 |
| `packages/ai-core/src/*.test.ts` | 30 项单元测试 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm ai:verify` | **28/28 通过**；Mock/OpenAI-compatible/工具权限/参数伪造/超时/重试/审计 |
| `corepack pnpm test` | **103/103 通过**（新增 30 项 ai-core 测试） |
| `corepack pnpm typecheck` | **19/19 Turbo tasks 通过** |
| `corepack pnpm lint` | 通过；无依赖边界违规 |
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm build` | **12/12 Turbo tasks 通过**（全量构建） |
| `corepack pnpm memory:verify` | 97/97 回归通过 |
| `corepack pnpm db:verify` | 110 项数据库检查回归通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查通过 |

关键安全断言：

- Mock Provider 的 `metadata.mock=true`、`provider='mock'`；结构化输出必须提供 `mockValue`，并由运行时 Schema 校验。
- OpenAI-compatible 适配器只通过注入的 `fetch` 调用；测试使用本地假响应，未使用真实密钥或网络。错误只返回稳定 code/message，不包含 API key、响应正文或私人输入。
- Provider 输入在调用前校验：消息 1–50 条、每条 1–20000 字符、temperature 0–2、maxTokens 1–32000、Embedding 1–64 条且维度 1–3072。
- 工具执行前先检查 `requiredPermissions` 与 `requiredUses`，再校验参数；伪造额外字段直接拒绝，工具不会执行。
- 工具参数和返回值都由 Zod Schema 校验；返回值不匹配时拒绝，不把未校验结果交给上层。
- 超时由执行器强制；重试只对 `idempotent=true` 且错误 `retryable=true` 的工具生效，次数受 `maxRetries` 限制。
- 审计事件只含工具名、action/resourceType、actor、requestId、attempt、状态、耗时和错误码；不含参数、返回值、正文或提示词。审计写入失败会显式抛出 `TOOL_AUDIT_FAILED`，不静默跳过。
- `ai-core` 不依赖数据库/Nest/React；工具通过注入的领域服务执行，不能直接 SQL/HTTP/文件系统。

## 已知限制

- 未连接真实 AI Provider，未验证真实成功/限流/超时/取消/数据出境；OpenAI-compatible 适配器仅通过假 fetch 验证。
- 未实现 M3-05 的 `POST /agent/turns` + SSE、run/step 持久化、取消/恢复、24 小时事件清理与真实代理/原生流验证。
- 未实现数据库审计 sink；当前 `InMemoryToolAuditSink` 仅用于测试，M3-05 需接入事务内审计/Outbox。
- 未实现模型路由、token/费用预算、并发预算、脱敏评估集与阈值（M3-07）。
- 未实现模型级 Prompt Injection 评估；已测试工具参数按数据处理、额外字段拒绝与权限/用途越权拒绝，模型规划与检索注入测试留待 M3-05/M3-07。
- 未实现真实领域工具（除 `memory.search` 契约示例）、Agent 规划/工具选择或运行时工具编排。
- 未实现 Web/Mobile AI 界面；Mock 标识需在 M3-07 页面中展示。

## 下一步

- M3-05：POST 创建 run + GET SSE，持久事件/来源依赖、游标、取消、重放鉴权与真实代理/原生流验证。
- M3-06：行动预览与确认，绑定草稿版本、有效期和一次性执行标识。
- M3-07：个人页面、记忆复核 UI、脱敏评估集与预算/阈值。
- 真实 Provider 接入前登记数据位置、保留、密钥与网络验证；Mock 结果不能作为智能能力完成证据。
