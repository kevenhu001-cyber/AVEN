# WEB-02：候选记忆复核、记忆编辑撤回与通知偏好

日期：2026-11-13。授权范围沿用 [ADR-017](../architecture/decisions/0017-personal-web-increment.md) 的个人 Web 限定接入，并按 [系统状态](SYSTEM_STATUS.md) 中 P0「M1-02–06、M3-07 产品界面」补齐候选复核与通知偏好。本轮没有新增数据库迁移、API 端点或服务端权限变更，也没有接入真实 Provider、第三方 OAuth 或原生端；M1-07 整体仍为 REVIEW。

## 已实现

- **候选复核界面**：在「记忆与上下文」面板新增「候选复核」标签页。粘贴按行描述（如 `兴趣：机器人与产品设计`），调用服务端 `POST /api/v1/memories/extract`，使用服务端确定性规则提取器 `mock_rules_v1` 生成待确认候选；界面明确标注为规则提取、不是真实模型理解。
- **逐条确认与拒绝**：候选卡片可编辑标题与正文，逐项勾选用途（`self_ai`、`sharing`，默认全部不勾选），确认走 `POST /api/v1/memories/:id/confirm` 并携带 `expectedVersion`；拒绝走 `POST /api/v1/memories/:id/reject`。确认或拒绝后候选立即离开待复核列表，已确认信息列表同步刷新。
- **已确认信息可编辑与撤回**：`PATCH /api/v1/memories/:id` 更新标题、正文与用途，仍以 `expectedVersion` 做乐观锁；`DELETE /api/v1/memories/:id?expectedVersion=` 撤回该条信息，界面需二次确认。撤回只影响本条信息，已经送达的共享副本无法收回。
- **通知偏好界面**：通知面板新增「通知偏好」卡片，逐项开关连接邀请、连接状态变化、活动提案与活动确认/取消通知；保存走 `POST /api/v1/notifications/preferences` 并携带 `expectedVersion`。界面乐观更新、保存失败时回读服务器状态并提示；过期版本由服务端以 409 拒绝。
- **共享客户端扩展**：`packages/api-client` 的个人记忆客户端新增 `candidates`、`extract`、`confirm`、`reject`、`update`、`remove`；传输层首次支持 `PATCH` 方法，并按写操作规则要求 CSRF 或 Bearer 凭据。

## 架构与安全

- 无新增依赖、无数据库迁移、无服务端代码改动；复用现有 `/api/v1/memories/*` 与 `/api/v1/notifications/preferences` 契约，Web 仍只经同源重写访问 API。
- 所有记忆写操作携带 `expectedVersion`；版本冲突（409）提示重新读取，不做静默覆盖，也不自动重试写请求。
- 候选与用途默认拒绝：候选未勾选任何用途即确认时，仅作为本人可见信息保存；勾选 `sharing` 也只是允许进入共享预览，实际发送仍需逐次确认。
- 提取器是服务端确定性规则（`mock_rules_v1`），界面与文档都标注其非真实模型；本轮没有把 Mock 结果描述为智能能力。
- 浏览器仍为 HttpOnly 会话 Cookie + 逐次读取的 CSRF Cookie；私密正文不写入 localStorage/sessionStorage；401 仍清空整个工作区。

## 验证

新增 `scripts/personal-web-review-verify.mjs`（Playwright + 真实 API/PostgreSQL/Redis 合成账号），并注册为 `pnpm personal-web:verify:review`。

| 检查 | 结果 |
|---|---|
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm lint` | 通过；198 个模块、618 条依赖无边界违规 |
| `corepack pnpm typecheck` | 20 个任务通过 |
| `corepack pnpm test` | 45 个文件、308 项通过（新增 `personal-memory.test.ts` 9 项） |
| `corepack pnpm build` | 12 个任务通过 |
| `pnpm personal-web:verify:review` | 12 项通过：候选提取、默认拒绝用途、确认后离开待复核、已确认信息显示所选用途、原位编辑、服务端保留编辑结果、撤回后服务端不再返回、通知偏好持久化并递增版本、控件反映保存状态、过期版本 409、浏览器无未捕获错误；桌面与 390px 手机截图写入 `var/design/personal-web-review/`（仅为页面证据，不代替业务验收） |
| `pnpm personal-web:verify` | 18 项通过（WEB-01 回归，未受本轮影响） |
| `pnpm personal-web:verify:recovery` | 7 项通过（会话恢复回归） |
| `corepack pnpm check:expo` | 仍失败：9 个 Expo 依赖低于推荐兼容版本；本轮未改移动端依赖 |

复跑方式（需要 Compose 依赖与已构建 API/Worker/Web）：

```bash
corepack pnpm build
corepack pnpm personal-web:verify:review
```

脚本只允许 `127.0.0.1`/`localhost`，写入独立合成账号与少量业务数据，不重建数据库、不清除全局限流。`.data/personal-web-review-*` 保存合成夹具，已被 Git 忽略。

## 限制与下一步

- 候选只来自服务端规则提取；没有对话自动抽取、真实模型理解或批量复核。
- 编辑与撤回只覆盖标题、正文和两项用途；字段级策略、校园范围、有效期、结构化字段仍只能在 API 层设置。
- 通知偏好只控制站内通知是否再产生新通知；没有移动推送、免打扰时段或死信处置界面。
- 未执行生产调度、真实 Provider、外部日历、原生设备验收与 GitHub Actions 实跑；0039 日历连接迁移仍为 pending，本轮未涉及。
- 下一项可独立推进的产品界面工作仍是会话小组件与插件接入（后端协议已交付），或 M5-02 pgvector 语义召回；两者都需各自满足验证门，不能互相替代。
