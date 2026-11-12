# P2P-02 连接客户端与小组件读取协议

日期：2026-11-12 · 范围：共享客户端、服务端读取协议和真实会话验证。产品聊天组件仍未编码。

## 实际交付

- `packages/api-client/src/connections.ts`：预览、幂等发送、邀请列表/详情、快照、小组件、决定、撤回、撤销与连接列表的类型化调用。
- `packages/api-client/src/index.ts`：保留健康检查接口，扩展 JSON 写入与逐次传入认证；输入错误为 `INVALID_REQUEST`，响应校验错误为 `INVALID_RESPONSE`，不会暴露 Zod/上游私人文本。
- `packages/contracts/src/index.ts`：严格的小组件响应契约，约束邀请与快照引用同一对象。
- `apps/api/src/connection/*`：新增 `GET /api/v1/connections/invitations/:id/widget`；从真实会话派生 sender/recipient 角色，在同一受限事务中先读取并锁定授权快照，再读取当前元数据。
- `packages/database/src/index.ts`：仅导出事务客户端类型供 API 使用。本轮没有数据库结构、迁移或受控函数变更，继续要求 0032。
- `scripts/connections-verify.ts`：在原有权限/并发/撤销验证上，新增共享客户端和小组件的真实 HTTP 验证。

## 认证、重试与展示边界

Web 调用使用浏览器会话 Cookie，写入显式传入登录返回的 CSRF；移动调用显式传入移动登录的 Bearer，设置 `credentials: omit`，不混用浏览器 Cookie。会话类型由服务端重新校验，客户端声明不赋予任何权限。Node 验证脚本用独立 Cookie jar 模拟 Web 会话；这不等于移动设备验证。

客户端没有持久化、正文缓存或全局会话，不自动重试任何写操作。发送邀请必须由调用方创建并保留 UUID 幂等键；超时、取消、网络断开后，原写操作可能已经提交，显式重试必须复用原预览和键。取消请求会阻止迟到结果交付调用方，但不能撤销服务端已经执行的写入。

```ts
const api = createApiClient({ baseUrl: apiOrigin });
const call = { auth: { kind: 'web' as const, csrfToken }, signal };
const widget = await api.connections.getWidget(invitationId, call);
// 仅在用户明确决定后调用；不由读取或启用插件触发。
await api.connections.decide(
  widget.invitation.id,
  { decision: 'accepted', expectedVersion: widget.invitation.version },
  call,
);
```

小组件数据按需读取，不写入 Agent 历史、列表缓存或本地存储。退出、身份切换、对象变化时，后续 UI 必须取消旧读取并清空已显示内容。状态/角色仅用于展示，不能当作写入权限凭证；实际动作仍走现有服务端权限、完整来源与版本检查。部分来源失效时可显示剩余项，但旧邀请不能接受；409 后应重新读取并让用户重新检查，不能自动确认。

## 已执行验证

- `corepack pnpm connections:verify`：12/12 构建任务、70/70 HTTP/数据库检查通过。
- 后续补充“小组件读取与撤回竞争”断言后，`corepack pnpm exec tsx scripts/connections-verify.ts`：71/71 通过。
- `corepack pnpm test`：21 个文件、179/179 通过。
- `corepack pnpm typecheck`：20/20 任务通过。
- `corepack pnpm lint`：ESLint 与依赖边界通过，123 个模块、369 条依赖。
- `corepack pnpm format:check` 与 `git diff --check`：通过。

真实 HTTP 验证覆盖独立双方会话与角色、外人 404/匿名 401、预览与幂等发送、读取/列表/决定/撤回/撤销、移动 Bearer 决定重放与会话撤销后 401、正文失效，以及小组件读取与撤回竞争下状态和内容一致。12 项新增单测覆盖默认值、CSRF、Bearers/Cookie 隔离、非法输入、响应损坏、对象关联、取消与迟到响应、显式重试、冲突和私人错误脱敏。所有数据均为开发数据。

初次构建发现 strict optional 属性下不能显式给 Fetch `body` 赋 undefined，已改为无正文时省略该属性，并完成后续构建。没有绕过类型或检查。

## 未实现与下一步

没有产品小组件、登录界面、Agent 工具绑定、会话内投递、真实插件运行时、通知、共同消息、真实 AI 或设备发布验收。M1-07 正式双端设计评审门不变；本轮协议不构成 UI 验收。

本轮未改依赖、未重跑 Expo 兼容检查；上一轮 9 个推荐补丁版本不匹配仍未关闭。没有 DB 结构变化，未重建数据库或重复空库迁移验证。没有更改前端页面，未重复诊断页 E2E；这些历史结果不能作为小组件 UI 证据。

下一步可完善个人邀请的保留清理与运行保障，并在正式双端评审完成后接入登录会话壳和对话内小组件。个人发现、跨终端通知与共同会话仍需独立交付。
