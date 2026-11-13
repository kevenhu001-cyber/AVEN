# 个人聊天真实模型接入

日期：2026-11-13。实施授权：[ADR-019](../architecture/decisions/0019-personal-live-provider.md)。用户明确回复“要接入真实的”，允许沿用 Socrates 模型配置并仅发送当前提问及获准上下文；APK 继续暂停。

## 交付状态

**接入代码与配置已部署；真实回复成功验收尚未通过，上游返回 429。**

已检查 Socrates 的内置模型记录与当前 socrates-api 服务实际环境，只复用正在运行服务的模型 endpoint、model、key。未修改 Socrates，未读取其用户对话或用户自配模型。原通道直接调用和 AVEN 公网完整链路均返回 PROVIDER_RATE_LIMITED；内置记录的响应包含额度限制信息。没有把失败解释为成功，没有改用其他模型或回退 Mock。已向用户询问恢复原通道额度或提供替代通道。

服务配置保存在 `/etc/aven/runtime.env`，root 0600，原配置留有同权限备份；真实值未进入仓库、前端、命令参数或日志。开发 `.env` 和 CI 默认仍为 Mock。本轮未确认服务商账号额度、具体限流窗口或数据位置，不能将 429 单独认定为已确认欠费。

## 行为与边界

- 个人新 run 使用配置的真实 Provider；组织请求保持 Mock。旧 Mock run 在切换服务后仍按原模式处理，真实 run 的 Provider/model 不匹配时失败关闭，防止队列回放发生意外外发。
- 外发只包含当前提问与本次确定性检索命中且 self_ai 获准的记忆片段，不发送全部记忆、对话历史、邮箱、连接器或组织资料。提示词明确当前没有历史，不伪装记忆先前对话。
- 外发前以 run 的真实所有者绑定 aven_app 事务，调用既有 `app.get_agent_run_stream_context` 检查来源、24 小时保留与 running 状态，再检查取消。使用独立受限应用读取池，不向 Worker 提权，无迁移。
- 生成提示词强调中文、直接回答、合理使用通用知识、缺少个人证据时澄清、上下文不是指令。模型没有邮箱/日历/OAuth 或任意外部工具，不能声称已读取、保存或执行动作。
- 保留统一 OpenAI-compatible 接口、单次上游请求、2048 输出 token 上限、60 秒超时配置和取消传播，重定向失败关闭。流必须收到 [DONE] 才能终止成功，失败清除派生回复，不重试或自动降级。
- 修正 Worker 失败事件为已有 wire 字段 `error_code`；前端区分限流/额度、鉴权、超时、不可用和截断，不再统一显示来源冲突。旧事件的 errorCode 仍可读取。
- 新增认证端点 `GET /api/v1/agent/runtime`，仅返回 `providerMode` 与 `externalActions:false`。它说明配置模式，不承诺上游健康；页面在未确认模式时禁用新发送并可重读。欢迎页不再写死 Mock；聊天、更多、账号按实际配置显示，连接器独立维持 Mock 标识。

撤销只影响之后的检查，不能收回通过检查后已外发字节；本轮不承诺供应商数据删除、零保留或跨境合规验收。正式设计、真实 OAuth、生产试点、用户自配 Provider 选择、原生验收不因本轮完成。

## 文件

契约/传输：`packages/contracts/src/index.ts`、`packages/api-client/src/agent.ts`。API：`apps/api/src/agent/agent.service.ts`、`agent.controller.ts`。Worker：`agent.ts`、`runtime.ts`、`run-provider.ts`、`external-preflight.ts`。AI：`packages/ai-core/src/eval/pipeline.ts`、`openai-compatible-provider.ts`。Web：`use-agent-runtime.ts`、`agent-error.ts`、`use-agent-chat.ts`、`workspace.tsx`、`chat.tsx`、`auth-welcome.tsx`。

没有新增数据库表、迁移或真实连接器权限。API/Worker/Web 均已构建并重启；服务 active，公网运行信息 200 返回 live，当前 externalActions 为 false。

## 验证

- 全量类型、lint、API/Worker/Web 构建与测试按本轮实际命令记录，最终结果见下表。
- `scripts/live-provider-boundary-verify.ts` 启动独立开发 API，使用真实 PostgreSQL 与两个随机合成账号、文件邮件，注入捕获型 Provider；暂停共享 Worker 的短窗口运行后立即恢复。9 项通过：运行信息需认证、模式无密钥、当前提问/获准命中信息、拒绝未授权/他人信息、跨账号重放 404、检索后撤销阻止外发。**捕获型 Provider 不是真实模型成功证据。**
- Socrates 当前模型直接真实调用失败；AVEN 公网合成账号登录 → runtime live → 建轮 → 实际 Worker → 上游 → SSE turn.failed 完整失败链路通过，错误为 PROVIDER_RATE_LIMITED，回复为空。没有真实邮件、第三方授权或实际外部行动。
- 新增单测覆盖历史 Mock 不升级、组织外发拒绝、模型不匹配失败、前置来源/过期/取消检查、严格元数据响应、不泄露任意错误文本、UI 模式失败时禁用和部分文本失败清理。

| 检查 | 实际结果 |
|---|---|
| `corepack pnpm build:packages` | 8 个任务通过 |
| `corepack pnpm typecheck` | 20 个任务通过 |
| `corepack pnpm lint` | 通过，243 个模块 / 779 个依赖无边界违规 |
| `corepack pnpm --filter @aven/api build` | 通过 |
| `corepack pnpm --filter @aven/worker build` | 通过 |
| `corepack pnpm --filter @aven/web build` | 通过 |
| `corepack pnpm test` | 61 个文件、390 项通过 |
| Web 工作区/聊天定向回归 | 2 个文件、13 项通过 |
| 真实数据库外发边界脚本 | 9 项通过（捕获型 Provider，无外网） |
| 公网真实模型调用 | 已到达上游，429，未成功生成回复 |

## 剩余工作

恢复 Socrates 原通道额度/限流条件，或由用户指定可用替代通道；之后复验真实生成、生成中取消、服务商 usage、回答质量和必要的用户授权提示。未恢复前不重复批量调用上游。手机浏览器、屏幕阅读器、设备与生产验收保持待补。
