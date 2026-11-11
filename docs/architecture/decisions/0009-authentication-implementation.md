# ADR-009：认证与会话实现

- 状态：已接受（M2-01 实现与本地验证）
- 日期：2026-11-11
- 补充：[ADR-002](0002-identity-and-sessions.md)；遵循 [ADR-007](0007-authorization-boundaries.md)
- 相关：[TDD](../TDD.md) · [SCHEMA](../../database/SCHEMA.md) · [API 认证契约](../../api/AUTH.md)

## 背景

ADR-002 已确定自建邮箱 + 密码、不透明会话与校园认证分离，但没有锁定 Argon2id 库、令牌格式、CSRF、限流、邮件和数据库函数边界。M2-01 需要在不引入第三方 Auth SaaS 的前提下实现可撤销、可审计、默认拒绝的认证。

## 决策

1. **密码哈希**：Argon2id，使用 `@node-rs/argon2` 2.2.2；参数 `memoryCost=19456 KiB`、`timeCost=2`、`parallelism=1`、`outputLen=32`。未知邮箱也执行一次 dummy 校验，降低时序枚举。
2. **会话**：32 字节随机令牌，base64url 编码；数据库只存 SHA-256 哈希。Web 使用 `HttpOnly`、`SameSite=Lax`、生产 `Secure` 的 `aven_session` Cookie；Mobile 使用 `Authorization: Bearer`。绝对有效期 30 天，空闲超时暂未强制。
3. **CSRF**：Web 会话绑定 CSRF token；数据库存 SHA-256 哈希，客户端使用可读 `aven_csrf` Cookie + `X-CSRF-Token` 请求头。写请求同时校验 Origin（存在时）、Cookie/头一致和会话哈希；Mobile Bearer 不需要 CSRF。
4. **数据库边界**：认证函数放在 `app` schema，`SECURITY DEFINER` 且所有者为 `aven_function_owner`；`aven_auth` 只执行注册、查找、会话创建、验证/重置等函数；`aven_app` 只执行会话查找、列表、撤销。运行角色不直接读写 `credentials`、token 哈希或 `sessions.token_hash`。
5. **限流**：Redis 固定窗口，登录按 IP 与邮箱、注册按 IP 与邮箱、重置/验证按 IP、修改密码按用户；Redis 不可用时认证失败关闭（503），不回退到无限流。
6. **邮件**：开发/测试使用 `.data/mail` 文件 sink（gitignored，不记录到日志）；生产邮件 Provider 未选择，未配置时注册/重置返回 503，不伪装已发送。
7. **邮箱验证**：注册创建一次性验证 token（SHA-256 存储，24 小时）；验证后 `email_verified_at` 生效。M2-01 允许未验证邮箱登录，但后续组织创建、共享与高影响操作必须要求已验证邮箱；该策略在 M2-02/M2-03 落实。
8. **密码重置/修改**：重置 token 1 小时、一次性；重置与修改密码都撤销该用户全部会话。修改密码先重新验证当前密码。
9. **不采用**：JWT access/refresh、NextAuth/Auth.js、Clerk/Supabase Auth、OAuth/社交登录、MFA/Passkey、账号锁定与设备指纹。它们是后续独立决策，不在 M2-01 假装完成。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| JWT access/refresh | 无状态、跨服务方便 | 撤销、重放和密钥轮换复杂 | 不采用 |
| Auth SaaS | 快速接入 | 数据位置、供应商锁定、RLS 边界不清 | 不采用 |
| 纯 double-submit CSRF | 实现简单 | 子域/注入场景弱于会话绑定 | 不采用 |
| 内存限流 | 无 Redis 依赖 | 多实例无效、重启丢失 | 不采用 |
| Argon2id 原生库 | 性能与参数可控 | 原生依赖需目标平台验证 | 采用，CI/Linux x64 已验证 |

## 后果

- 每个受保护请求需要一次 `app.session_lookup` 数据库调用；换取即时撤销。
- 认证函数与表权限集中在数据库包；新增认证入口必须通过受控函数，不能绕过 RLS 直接写表。
- 生产必须配置 `AUTH_IP_SALT`、HTTPS、邮件 Provider 和 Secret Manager；当前 `.env.example` 只含开发占位值。
- 账号锁定、MFA、设备管理、空闲超时、邮件模板/退信处理和真实邮件投递仍未实现。

## 验证

- [x] 注册、邮箱验证、登录、登出、`me`、会话列表/撤销、密码修改/重置通过真实 HTTP 与 PostgreSQL/Redis 验证。
- [x] Argon2id hash/verify、随机令牌、SHA-256 哈希、IP 盐化通过单元测试。
- [x] 错误密码、重复注册、缺失 CSRF、已撤销会话、旧密码、限流均返回预期错误。
- [x] `aven_app` 不能执行认证查找/会话创建；`aven_auth` 不能直接读 `principals`。
- [ ] 真实邮件 Provider、生产部署、账号锁定、MFA、空闲超时、设备管理与恢复演练。
