## 背景

本机没有 Docker/Postgres，完整后端起不来；目前只能靠测试夹具/临时脚本看 UI。需要一条**可复用、一键启动、无任何外部依赖**的模拟网页途径：Web 应用自己内置一个模拟 API 层，`pnpm dev:web:mock` 即可浏览/操作整个个人 Web（登录态、发消息、流式回复、会话历史、应用目录、通知、记忆全部可用）。

## 方案：Web 内置模拟 API 层（Next Route Handler + 显式环境开关）

### 1. 开关与代理（`apps/web/next.config.ts`）
- 环境变量 `AVEN_WEB_MOCK=1` 时：rewrites 返回 `[]`（不再代理到 `API_INTERNAL_URL`），请求落到 Web 自己的 Route Handler。
- 未开启时：现有两条 rewrite（`/health/*`、`/api/v1/*`）改为 `{ beforeFiles: [...] }` 返回——行为与今天等价，且保证真实 API 优先于 handler（mock handler 在非 mock 模式下不可达，双保险 404）。

### 2. 模拟层（`apps/web/src/mocks/`，全部经 contracts schema 自校验 + 响应头 `x-aven-mock: 1`）
- `state.ts`：进程内单例种子状态（模拟用户、3 个会话与消息、通知、记忆、插件目录、连接器状态），提供 append/读操作函数。
- `replies.ts`：模拟回复生成——以「【模拟回复】」开头的固定 markdown（引用输入摘要 + 列表/代码块，供渲染开发用），诚实标识。
- `handlers.ts`：`mockRequest(method, path, search, body)` → `{status, headers, json | stream}`；`me`/`login` 响应 Set-Cookie `aven_csrf`（非 HttpOnly，`webCall` 可读，写操作即刻可用）。
- **端点覆盖个人 Web 全链路**：auth（me/login/register/logout/verify-email）、agent（turns、runs/:id、cancel、**events SSE 流式**：turn.started → delta×N（~120ms 间隔）→ turn.completed，取消时 turn.cancelled；完成后回复写入 messages——对齐真实 Worker 行为，侧栏历史会真实更新）、conversations 列表/消息、memories 全套（list/create/candidates/confirm/reject/update/remove）、notifications（list/read/preferences）、plugins（catalog + invoke，widgets 空）、open-connector（list/connect/refresh/disconnect）、connections（空列表）。admin/organizations/health 不在覆盖范围（404，文档注明）。

### 3. Route Handler（`apps/web/src/app/api/v1/[...path]/route.ts`）
- GET/POST/PUT/PATCH/DELETE 全捕获；`export const dynamic = 'force-dynamic'`；非 mock 模式一律 404 JSON。

### 4. 诚实标识（AGENTS.md Mock 规则）
- 根 layout（server component）读 env → 渲染固定徽标「**模拟数据 · 非真实服务**」于每页；
- 模拟回复文本自带「【模拟回复】」前缀；
- 每个 mock 响应带 `x-aven-mock: 1` 头；
- 未显式设置 `AVEN_WEB_MOCK=1` 时整个层完全不可达。

### 5. 启动器与命令
- `scripts/mock-web.mjs`：设置 `AVEN_WEB_MOCK=1` 后 spawn `pnpm --filter @aven/web dev`（win32 shell，参照 `scripts/dev.mjs`/`test-server.mjs` 模式）。
- `package.json` 新增 `"dev:web:mock": "node scripts/mock-web.mjs"`。

### 6. 单测
- `apps/web/src/mocks/mocks.test.ts`：me 种 CSRF cookie、POST turns → SSE 消费 → 回复入 messages → conversations 列表可见（模拟真实闭环）、cancel 路径、notifications 读写、所有响应经 contracts 自校验（~8 项）。

### 7. 文档
- `docs/development/SETUP.md` 新增「无 Docker/Postgres 的模拟启动」小节（命令、能力边界、诚实标识说明）；
- AGENTS.md §1 一行记录 + §12 命令；
- `.env.example` 增加 `AVEN_WEB_MOCK` 注释行。

## 明确不做
- 不模拟真实业务校验/RLS/幂等语义（仅幂等键简单回放）、不覆盖 admin/organizations/health、不引入 MSW 等新依赖（零依赖手写分发）、模拟数据不代表任何功能完成。

## 验证
1. `pnpm typecheck / test / lint / format:check / build`（mock 层单测纳入现有 vitest）
2. `pnpm dev:web:mock` 启动后 curl 冒烟：`/api/v1/auth/me`（含 Set-Cookie）、`POST turns` + SSE 事件流、`GET conversations`；浏览器实测：首页直接提问 → 模拟回复流式渲染 → 侧栏出现新会话 → 恢复会话、/apps、/memory、/notifications 全页可走通
3. 截图核对模拟徽标与各页面