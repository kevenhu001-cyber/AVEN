# 认证与会话 API 契约

版本：1.0 · 日期：2026-11-11 · 状态：M2-01 已实现并通过本地真实 HTTP/数据库验证
相关：[API 规范](README.md) · [ADR-009](../architecture/decisions/0009-authentication-implementation.md) · [TDD](../architecture/TDD.md)

所有路径带 `/api/v1/auth`。请求/响应以 `packages/contracts` 的 Zod Schema 为准；错误使用统一结构。私人响应 `Cache-Control: no-store`。

## 会话方式

- Web：登录设置 `aven_session`（HttpOnly、SameSite=Lax、生产 Secure）与 `aven_csrf`（可读）Cookie。写请求必须带 `X-CSRF-Token`，且与 Cookie、会话哈希一致。
- Mobile：登录返回 `sessionToken`，后续使用 `Authorization: Bearer <token>`；不使用 Cookie/CSRF。
- 会话令牌 32 字节随机数；数据库只存 SHA-256 哈希。绝对有效期默认 30 天。
- 受保护端点：`GET /me`、`GET /sessions`、`POST /sessions/:id/revoke`、`POST /logout`、`POST /password/change`。

## POST /register

- 认证：公开；按 IP 5 次/小时、邮箱 3 次/小时限流。
- 请求 `RegisterRequest`：`{email, password, displayName}`；邮箱 trim + 小写，密码 12–128 字符，显示名 1–120。
- 成功 201 `RegisterResponse`：`{user, verificationRequired:true}`；不返回密码、哈希或会话。
- 失败：`VALIDATION_ERROR` 422、`CONFLICT` 409（邮箱已存在）、`RATE_LIMITED` 429、`SERVICE_NOT_READY` 503（邮件/限流依赖未配置）。
- 副作用：同一事务创建 principal、user、user_private、credential、邮箱验证 token；验证 token 只存哈希，开发环境写入 `.data/mail` 文件 sink。
- 未验证邮箱允许登录；后续高影响操作要求验证。

## POST /login

- 认证：公开；按 IP 10 次/15 分钟、邮箱 5 次/15 分钟限流。
- 请求 `LoginRequest`：`{email, password, client:"web"|"mobile"}`；`client` 默认 `web`。
- 成功 200 `AuthResponse`：`{user, session, csrfToken? , sessionToken?}`。
  - Web：设置两个 Cookie，返回 `csrfToken`，不返回 `sessionToken`。
  - Mobile：返回 `sessionToken`，不返回 `csrfToken`。
- 失败：`UNAUTHENTICATED` 401（邮箱不存在、密码错误、主体非 active 使用同一响应）、`RATE_LIMITED` 429、`SERVICE_NOT_READY` 503。
- 未知邮箱执行 dummy Argon2id 校验，降低时序枚举；不记录邮箱、密码或令牌。

## POST /logout

- 认证：受保护；Web 需要 CSRF。
- 成功 204；撤销当前会话并清除两个 Cookie。重复登出幂等。

## GET /me

- 认证：受保护。
- 成功 200 `MeResponse`：`{user:{id,displayName,email,emailVerified,locale,timezone}, session:{id,client,userAgent,createdAt,lastSeenAt,expiresAt,revokedAt,current}}`。
- 失败：`UNAUTHENTICATED` 401。

## GET /sessions

- 认证：受保护。
- 成功 200 `SessionListResponse`：`{data:[AuthSession]}`，按创建时间倒序，最多 50 条；当前会话 `current=true`。不返回 token/hash。

## POST /sessions/:id/revoke

- 认证：受保护；Web 需要 CSRF；只能撤销本人会话。
- 成功 204；不存在或不属于本人返回 `NOT_FOUND` 404（不透露其他主体会话）。
- 撤销后该会话的新请求立即 401；不承诺收回已送达字节。

## POST /verify-email

- 认证：公开；按 IP 10 次/小时限流。
- 请求 `VerifyEmailRequest`：`{token}`。
- 成功 200 `{ok:true}`；无效/过期返回 `VALIDATION_ERROR` 422。
- token 一次性消费；成功后设置 `email_verified_at`。

## POST /password/reset-request

- 认证：公开；按 IP 5 次/小时、邮箱 3 次/小时限流。
- 请求 `PasswordResetRequest`：`{email}`。
- 成功 202 `{ok:true}`；无论账号是否存在都返回相同状态，避免枚举。
- 开发环境将重置 token 写入 `.data/mail`；生产邮件未配置时返回 `SERVICE_NOT_READY` 503。
- token 1 小时、一次性，只存哈希。

## POST /password/reset

- 认证：公开；按 IP 5 次/小时限流。
- 请求 `PasswordReset`：`{token, password}`。
- 成功 204；无效/过期 token 返回 `VALIDATION_ERROR` 422。
- 副作用：更新密码哈希、清除失败计数/锁定、撤销该用户全部会话。

## POST /password/change

- 认证：受保护；Web 需要 CSRF；按用户 5 次/小时限流。
- 请求 `ChangePassword`：`{currentPassword, newPassword}`。
- 成功 204；当前密码错误返回 `UNAUTHENTICATED` 401。
- 副作用：更新密码并撤销全部会话（包括当前会话）；响应清除 Cookie，客户端需要重新登录。

## 错误与安全

- 统一错误：`{error:{code,message,request_id,retryable}}`；不返回堆栈、SQL、密码哈希、token 或数据库地址。
- 数据库/Redis 不可用映射为 `SERVICE_NOT_READY` 503、`retryable=true`；限流返回 `Retry-After`。
- 认证函数由 `aven_function_owner` 持有；`aven_auth` 只执行注册/查找/会话创建/验证/重置函数，`aven_app` 只执行会话查找/列表/撤销；运行角色不能直接读 `credentials` 或 token 哈希。
- 生产必须配置 HTTPS、`AUTH_IP_SALT`、邮件 Provider 与 Secret Manager；`AUTH_DEV_MODE` 在生产被拒绝。

## 验收

- `corepack pnpm auth:verify`：42 项真实 HTTP/数据库/Redis 检查通过。
- `corepack pnpm test`：认证 contracts、Argon2id、令牌哈希与环境边界单元测试通过。
- 未验证：真实邮件 Provider、生产部署、账号锁定、MFA、空闲超时、设备管理、真实设备 Cookie/Bearer 生命周期。

## WEB-01 客户端接入（2026-11-12）

`@aven/api-client.auth` 增加 `me/loginWeb/register/verifyEmail/logout`。`loginWeb` 强制 `client: web` 且拒绝包含移动 `sessionToken` 的返回；退出接受既有 204 空响应。浏览器逐次读取 CSRF Cookie，私人正文与认证令牌不写入浏览器持久存储。首页已接入这些端点，开发邮件仍是本地文件；不代表生产邮件、MFA 或完整设备会话 UI 完成。
