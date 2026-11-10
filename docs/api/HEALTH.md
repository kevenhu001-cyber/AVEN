# 工程探针契约

阶段：M0-06；业务接口、认证与队列消费尚未实现。

## GET /health/live

- 不要求账号，无私人数据；仅报告进程可处理请求，不证明数据库、Redis、迁移或业务已就绪。
- API 与 Worker 管理端口使用同一 `LivenessResponseSchema`：`{status:"ok", service:"api"|"worker", stage:"foundation", request_id:UUID}`。
- 接受合法 UUID 的 X-Request-Id，否则生成新 ID；响应头与正文一致。不回显任意输入、完整 URL、环境变量或堆栈。
- 200，Cache-Control: no-store。

## GET /health/ready

- API 使用 `aven_app` 连接检查：PostgreSQL `SELECT 1`、Redis `PING`、`app.schema_migrations` 中存在当前必需版本（当前 `0006_outbox_available_at_grant`）。
- Worker 使用相同依赖检查，并额外要求队列消费者就绪；M0-07 样例消费者运行时就绪 200，消费者未运行或 Redis 不可用时 503。
- 成功返回 `ReadinessResponseSchema`：`{status:"ok", service, stage:"foundation", checks:{database,redis,migrations,consumers?}, request_id}`。
- 任一检查失败返回 503，统一错误 `code=SERVICE_NOT_READY`、`retryable=true`；不返回数据库地址、Redis URL、SQL、堆栈或迁移内容。
- 检查超时约 2 秒；API 使用短生命周期连接池与 Redis 连接，避免探针长期占用连接。
- Cache-Control: no-store。

## 访问与客户端

- API 默认 127.0.0.1:3001；Worker 独立管理探针默认 127.0.0.1:3002，不启动 HTTP 业务路由。
- Web 的同源 `/health/*` 代理到 API；未来 `/api/v1/*` 保持同路径代理。内部 API 地址只在 Next 服务端配置，不暴露到 NEXT_PUBLIC。
- Expo 使用明确配置的 `EXPO_PUBLIC_API_URL`（API origin）；设备不能用开发机 localhost。未配置/非法地址先提示配置问题，不伪造在线状态。
- Web 与 Expo 工程页分别提供存活与依赖就绪检查；失败状态明确显示，不把 503 渲染为成功。依赖就绪不代表业务功能完成。
- 工程页支持实际请求、失败反馈、重试与取消；不展示虚构用户/机会，也不提供未实现模块的可用按钮。

验收：真实 HTTP 的 live/ready、错误结构、请求 ID、CORS 允许列表、网络失败/超时/取消，以及 Web 同源代理。`scripts/check-readiness.mjs` 使用真实 Compose 依赖验证 API 200、Redis 故障 503 与 Worker 消费者运行时就绪 200。Expo 导出和真机连接分别记录，不以 Web 浏览器结果代替原生测试。
