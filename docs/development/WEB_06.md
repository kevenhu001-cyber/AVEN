# WEB-06：独立页面、统一界面与真实接入

日期：2026-11-13。范围沿用 ADR-017/018/019，只调整个人 Web 结构与真实 Provider/连接器接入；不改变 M1-07 整体 REVIEW 结论，也不代表生产或原生验收完成。

## 目标

1. 把原先的单页屏幕栈（首页 → 资料页 / 对话页）与底部 Sheet 改为独立 URL 页面。
2. 所有 Web 页面共用一套 Halo 深色界面与导航。
3. 去掉 Mock 对话与 Mock 授权作为产品路径，改为真实模型与真实 Open Connector 授权；没有凭据时明确显示不可用，而不是返回样例数据。

## 页面结构

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | 首页 | 角色、模型状态、新对话、搜索 |
| `/chat` | 对话 | 真实 Agent SSE；`?q=` 打开聊天内查找 |
| `/profile` | Bot 资料 | 通知偏好与资料库入口 |
| `/memory` | 记忆与上下文 | 手工记忆、候选复核、编辑与撤回 |
| `/connections` | 我的连接 | 邀请、预览、会话消息 |
| `/notifications` | 通知 | 收件箱与偏好 |
| `/account` | 账号与设置 | 邮箱验证、本人模型配置、退出登录 |
| `/apps` | 连接应用 | 服务端连接器目录；真实凭据状态 |
| `/apps/[id]` | 连接应用详情 | 动作与结果 |
| `/connectors` | 账号授权 | Open Connector OAuth |
| `/admin` | 平台配置 | 管理员模型与网关配置 |
| `/plugins` | 兼容入口 | 重定向到 `/apps` |
| `/organizations/[id]` | 组织控制台 | 概览、机会、成员、收件箱 |
| `/diagnostics` | 工程诊断 | 存活/就绪探针 |

- `apps/web/src/app/(personal)/`：需要会话的个人页面。
- `apps/web/src/app/(platform)/`：不因未登录而阻塞的工程/管理页面。
- `apps/web/src/components/shell/`：统一侧栏、顶部栏、移动端底部导航与页面容器。
- 会话状态在 `features/personal/session.tsx`，对话与目录状态在 `features/personal/app-state.tsx`，跨路由保留当前对话。

## 真实接入

### 模型

- 新增迁移 `0043_agent_provider_runtime`：
  - `app.get_effective_ai_provider()` 返回当前用户的有效 Provider 来源、地址与模型。
  - `app.get_agent_provider_runtime(user_id)` 仅供 Worker 读取加密密钥。
- API 在创建 run 时解析有效 Provider（本人配置 → 平台配置 → 环境配置），并把 provider/model 写入 run。
- Worker 按 run 读取并解密密钥，使用 `OpenAICompatibleProvider` 执行；没有配置时返回 `PROVIDER_NOT_CONFIGURED`，不再静默回退 Mock。
- 新增 `GET /api/v1/agent/provider/status` 与 `/account` 的本人模型配置表单（保存/更新/删除，`expectedVersion` 乐观锁）。
- 环境 Provider 仍可显式设为 `mock` 供测试使用；产品界面不再把 Mock 结果描述为模型能力。

### 连接器

- 对话内授权卡与 `/apps` 只显示真实 Open Connector 状态；`gmail`、`googledrive`、`github`、`googlecalendar`、`outlook` 跳转 `/connectors` 完成 OAuth。
- 插件动作只有 `credentialStatus === 'configured'` 时可用，并以 `allowLive: true` 调用；未配置凭据时按钮禁用，不再生成 Mock 小组件。
- 网关不可达、拒绝或返回异常时，`/connectors` 显示 503 不可用状态，不回退为模拟成功。

## 验证

- `pnpm typecheck`：20 个任务通过。
- `pnpm lint`：通过，260 个模块、749 条依赖无边界违规。
- `pnpm test`：50 个文件、346 项通过。
- `pnpm build`：12 个任务通过（含 Web、API、Worker 与移动端 JS 导出）。
- `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`：桌面与手机尺寸共 28 项通过。
- `pnpm db:verify`：空库、升级、seed 与全部数据库检查通过（43 个迁移）。
- 真实推理：本地 API + Worker + PostgreSQL + Redis，使用配置的 OpenAI-compatible Provider，`POST /api/v1/agent/turns` → Outbox → Worker → SSE 返回真实中文回复；浏览器 `/chat` 显示“回复完成”。
- 真实网关：本机到 `connector.oomol.com` 网络超时，`/api/v1/open-connector/gmail/connect` 返回 503 `SERVICE_NOT_READY`；未伪造授权成功，OAuth 联调仍需可访问网关的环境。

## 已知限制

- Open Connector OAuth 未在本机完成真实第三方授权（网关网络不可达）。
- 地图、电商、邮箱等插件需要各自真实凭据；未配置时动作不可用。
- 移动端、原生推送、真实日历、生产调度/监控/备份恢复未在本轮改动。
- `db:verify:current` 在累积了合成账号的开发库上可能因组织数量夹具失败；以空库 `db:verify` 为准。
