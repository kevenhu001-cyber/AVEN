# 注册冲突与邮件失败恢复

日期：2026-11-13。用户反馈注册显示“内容或授权已变化，请重新读取”。

## 原因与改动

部署日志有两次注册 409；原 API 将邮箱唯一约束冲突返回通用 Conflict，Web 共用业务错误提示把它解释为授权或内容变化。另有可复现的恢复缺陷：数据库已创建账号后 SMTP 发送失败，接口仍返回 503，用户再次注册就遇到重复邮箱。没有读取用户邮箱或密码，也未确认用户当次是否经历邮件失败。

- API 对既有账号返回 409 `ACCOUNT_ALREADY_EXISTS`；Web 显示邮箱已有账号，并提供“直接登录”和“找回密码”。邮箱输入保留，密码清空。其他业务的版本/授权冲突提示不变。
- 未验证且活跃的账号用正确原密码重试注册，可复用用户并重发验证邮件；不覆盖原显示名、密码、语言或时区。错误密码、已验证或停用账号不能通过此路径重发。
- 创建账号后发送邮件失败，返回 201 与 `verificationDelivery: failed`，明确账号已创建，可先登录或按原凭据重试。`sent` 仅代表传输接受，不代表收件箱实际送达。
- 沿用每 IP 每小时 5 次、每邮箱每小时 3 次注册限额；没有清除线上限流键。使用既有受限认证角色和 `app.create_email_verification_token`，无迁移或新端点。

主要代码：`apps/api/src/auth/auth.service.ts`、`packages/contracts/src/index.ts`、`apps/web/src/features/personal/auth-form.tsx`、`auth-errors.ts`。契约见 [AUTH](../api/AUTH.md)。可选响应字段同时由共享客户端校验，Android 本轮无 UI 或构建改动。

## 实际验证

| 命令/检查 | 结果 |
|---|---|
| `corepack pnpm test` | 54 个文件、352 项通过，新增认证错误提示 4 项 |
| `corepack pnpm typecheck` | 20 个任务通过 |
| `corepack pnpm lint` | 通过，234 个模块 / 758 个依赖无边界违规 |
| `corepack pnpm build:packages` | 8 个任务通过 |
| `corepack pnpm --filter @aven/api build`、`corepack pnpm --filter @aven/web build` | 通过 |
| `corepack pnpm exec tsx scripts/registration-verify.ts` | 10 项通过：邮件失败仍创建、原密码重发、身份/资料不变、错误密码拒绝且无邮件、原密码登录、跨 IP 邮箱限流、邮件验证、已验证账号冲突 |
| `corepack pnpm exec tsx scripts/password-recovery-verify.ts` | 11 项恢复回归通过 |
| 部署 | 重启 aven-api、aven-web 后三项服务均 active；公网首页 200；已有合成账号以错误密码注册得到 409 ACCOUNT_ALREADY_EXISTS，没有发送邮件 |

注册与恢复脚本启动独立 API，使用随机合成账号、独立 IP salt、本地文件邮件与模拟发送故障；不发送外部邮件或清空全局频控。注册快捷命令为 `corepack pnpm registration:verify`。线上检查仅用已有合成账号与错误密码，未测试真实收件箱。本轮没有新增浏览器交互或原生验收证据。

## 边界

SMTP 真实收件箱投递仍待用户实测。认证系统既有 MFA、锁定等生产缺口不因本次修复关闭；正式设计评审保持 REVIEW。APK 继续暂停，仅保留手动工作流。
