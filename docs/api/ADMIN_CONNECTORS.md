# 平台配置与 Open Connector API

2026-11-13，依据 ADR-019。所有接口使用现有 Cookie + CSRF / 移动 Bearer 鉴权和统一错误结构。

## 平台管理员配置

- `GET /api/v1/admin/configurations`：逐次核对数据库中的有效 `platform_admin` 分配，返回 `{data:[{kind,baseUrl,model,version,updatedAt}]}`，不返回密钥；顶层 `connectorEnvironmentConfigured` 表示服务器是否显式配置了网关环境密钥（仅管理员可读取）。
- `PUT /api/v1/admin/configurations/:kind`：`kind` 为 `model` 或 `open_connector`；输入 `{baseUrl,model,apiKey,expectedVersion}`。新建版本为 0，更新需提交当前版本；冲突返回 409，禁止自动覆盖。服务端检查 URL 允许列表，AES-256-GCM 加密密钥。模型名称在 `model` 配置中不能为空。每次保存追加仅含种类、版本、操作者、时间的审计记录。
- 无删除或启用接口；保存模型不会启用真实推理。平台设置独立于已有用户级模型设置。

## 账号授权

- `GET /api/v1/open-connector`：仅本人关联的服务、状态、到期和更新时间。
- `POST /api/v1/open-connector/:service/connect`：服务限 Gmail、Google Drive、GitHub、Google Calendar、Outlook；使用管理员保存的 OOMOL Project API Key，经 `@oomol-lab/connector` 1.2.1 发起 OAuth，返回 `{authorizationUrl,expiresAt}`。当前无真实动作执行入口。
- `POST /api/v1/open-connector/:service/refresh`：仅查询服务端保存的本人请求 ID；验证网关返回的请求 ID、externalUserId 与 service 后更新状态。回跳 URL 的参数不能使账号变成已连接。
- `DELETE /api/v1/open-connector/:service`：仅移除 AVEN 本地关联，**不撤销提供方授权**。用户仍需前往提供方撤销。

固定网关为 `https://connector.oomol.com/v1`；外跳地址必须为 HTTPS 且精确命中 `OPEN_CONNECTOR_AUTH_HOSTS`。回跳地址由 `WEB_ORIGIN` 生成，不信任客户端 Host。网关持有第三方 token，AVEN 只保留不透明请求/账号 ID，RLS 按 user_id 隔离。

外部请求无自动重试；用户遇到结果未知时应先核对状态。暂不支持重建丢失的网关请求、分布式幂等连接创建、提供方授权撤销或后台刷新；进程在网关创建成功而本地入库前退出可能留下网关侧未关联请求，需运维排查，不能宣称 exactly-once。

运行时仅在管理员未保存网关配置时使用 `OOMOL_PROJECT_API_KEY` 环境密钥。已有保存配置无法解密时失败，不回退；授权域名列表为空时先拒绝再进行任何远端请求。
