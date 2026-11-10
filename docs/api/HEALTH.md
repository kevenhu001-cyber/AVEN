# 工程探针契约

阶段：M0-03 骨架；业务接口和 M0-06 完整依赖就绪尚未实现。

## GET /health/live

- 不要求账号，无私人数据；仅报告进程可处理请求，不证明数据库、Redis 或业务已就绪。
- API 与 Worker 管理端口使用同一 `LivenessResponseSchema`：`{status:"ok", service:"api"|"worker", stage:"foundation", request_id:UUID}`。
- 接受合法 UUID 的 X-Request-Id，否则生成新 ID；响应头与正文一致。不回显任意输入、完整 URL、环境变量或堆栈。
- 200，Cache-Control: no-store。

## GET /health/ready

- M0-03 始终 503：统一错误 code=SERVICE_NOT_READY、retryable=false，说明依赖探针/消费器尚未配置，不返回数据库地址。
- M0-04/05/06 实现后再按主库、Redis、迁移版本与 Worker 消费状态计算；未配置不可默认为成功。

## 访问与客户端

- API 默认 127.0.0.1:3001；Worker 独立管理探针默认 127.0.0.1:3002，不启动 HTTP 业务路由。
- Web 的同源 /health/* 代理到 API；未来 /api/v1/* 保持同路径代理。内部 API 地址只在 Next 服务端配置，不暴露到 NEXT_PUBLIC。
- Expo 使用明确配置的 EXPO_PUBLIC_API_URL（API origin）；设备不能用开发机 localhost。未配置/非法地址先提示配置问题，不伪造在线状态。
- 工程页支持实际请求、失败反馈、重试与取消；不展示虚构用户/机会，也不提供未实现模块的可用按钮。

验收：真实 HTTP 的 live/ready、错误结构、请求 ID、CORS 允许列表、网络失败/超时/取消，以及 Web 同源代理。Expo 导出和真机连接分别记录，不以 Web 浏览器结果代替原生测试。
