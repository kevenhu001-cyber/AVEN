# M2-01 认证与会话

日期：2026-11-11 · 状态：注册、登录、登出、邮箱验证、会话列表/撤销、密码修改/重置已实现并通过真实 HTTP/数据库/Redis 验证；生产邮件、MFA、账号锁定与真实设备未实现

## 范围

本轮实现自建邮箱 + 密码认证的最小闭环：Argon2id、不透明会话、Web Cookie/Mobile Bearer、会话绑定 CSRF、Redis 限流、邮箱验证与密码重置 token、认证数据库函数与最小权限。未实现组织/校园/个人资料、真实邮件投递、MFA、Passkey、账号锁定、空闲超时与生产部署。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0007_authentication.sql` | `sessions.csrf_token_hash`、邮箱规范化约束、13 个认证函数、函数所有权、RLS 策略与角色授权 |
| `packages/contracts/src/index.ts` | 注册/登录/会话/验证/重置/修改密码 Zod Schema |
| `apps/api/src/auth/*` | AuthModule、Controller、Guard、Service、Argon2id、令牌、Cookie、CSRF、Redis 限流、开发邮件 sink |
| `apps/api/src/http-errors.ts` | 409 冲突、429 + Retry-After、数据库/Redis 依赖失败 503 |
| `packages/config/src/env.ts` | `AUTH_DEV_MODE`、`AUTH_SESSION_TTL_DAYS`、`AUTH_IP_SALT`、`AUTH_MAIL_DIR` 与生产校验 |
| `scripts/auth-verify.ts` | 真实 API/PostgreSQL/Redis 的 42 项认证检查 |
| `docs/api/AUTH.md` / `docs/architecture/decisions/0009-authentication-implementation.md` | 端点契约与实现决策 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm auth:verify` | 42/42 通过；注册、重复注册、验证邮件、错误密码、Web 登录、Cookie/CSRF、`me`、会话列表、登出、密码修改/重置、Mobile Bearer、会话撤销、限流 |
| `corepack pnpm test` | 59/59 通过；新增认证 contracts、Argon2id、令牌哈希与环境边界测试 |
| `corepack pnpm db:verify` | 7 个迁移、认证函数存在/所有权、`aven_app` 不能执行认证查找/会话创建、`aven_auth` 不能直接读 principals、会话查找可用 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查仍通过 |
| `corepack pnpm typecheck` / `build` | 18/18 与 11/11 Turbo tasks 通过 |

关键安全断言：

- 密码使用 Argon2id，数据库只存哈希；未知邮箱执行 dummy 校验。
- 会话令牌只存 SHA-256；Web Cookie `HttpOnly`，CSRF Cookie 可读但与会话哈希绑定。
- 缺失 CSRF 的 Web 写请求返回 403；撤销/登出/改密后的旧会话立即 401。
- 重复注册返回 409；错误密码统一 401；登录/注册/重置限流返回 429 + `Retry-After`。
- `aven_app` 不能执行 `auth_lookup`/`create_session`；`aven_auth` 不能直接读 `principals`；认证函数由 `aven_function_owner` 持有。
- 开发邮件 sink 写入 `.data/mail`（gitignored），不写日志；生产未配置邮件时返回 503。

## 已知限制

- 生产邮件 Provider、发件域、退信/投诉处理未选择；当前只有开发文件 sink。
- 未验证邮箱允许登录；组织创建、共享与高影响操作需要在 M2-02/M2-03 强制验证。
- 未实现账号锁定、失败次数持久化、MFA/Passkey、设备管理、空闲超时、会话轮换、可疑登录通知。
- 未实现真实 Android/iOS 的 Cookie/Bearer 生命周期、Secure Storage、深链回调与后台恢复。
- 未做生产 HTTPS、反向代理、CSRF Origin 全链路、限流多实例与 Redis 故障演练。
- 认证 API 尚未接入 Web/Mobile 页面；当前只有工程验证脚本与契约。

## 下一步

- M2-02：主体、校园成员与个人资料，强制已验证邮箱的高影响操作。
- M2-03：组织成员、邀请、角色与最后管理员保护。
- M2-04/M2-05：写策略、`FORCE RLS`、跨账号/跨组织隔离集成测试。
- 真实数据前：选择邮件 Provider、完成隐私/数据位置评估与恢复演练。
