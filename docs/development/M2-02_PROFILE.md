# M2-02 主体与校园身份

日期：2026-11-11 · 状态：个人资料更新、校园列表与校园成员申请已实现并通过真实 HTTP/数据库验证；审核与组织成员未实现

## 范围

本轮在 M2-01 认证基础上实现：当前用户显示名/locale/timezone 更新、活跃校园列表、本人校园成员列表、申请 pending 校园成员。未实现校园审核、邮件域名验证、学号/证件流程、组织成员、邀请与角色。校园成员状态与官方认证分离，申请不会自动变成 verified。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0008_profile_and_campus.sql` | `app.update_my_profile`、`app.list_active_campuses`、`app.list_my_campus_memberships`、`app.request_campus_membership`、函数所有权与授权 |
| `packages/contracts/src/index.ts` | `UpdateProfileRequest`、`Campus`、`CampusMembership`、校园列表/成员/申请 Schema |
| `apps/api/src/profile/*` | ProfileModule/Controller/Service；事务本地用户上下文；CSRF 由 AuthGuard 统一校验 |
| `apps/api/src/http-validation.ts` | 共享 Zod 解析与请求上下文 |
| `scripts/profile-verify.ts` | 16 项真实 HTTP/数据库检查 |
| `docs/api/PROFILE.md` | 端点契约与安全边界 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm profile:verify` | 16/16 通过；资料更新、版本递增、`me` 反映、校园列表、空成员、pending 申请、重复幂等、CSRF、非法时区/显示名、未知校园 |
| `corepack pnpm test` | 61/61 通过（新增 profile/campus contracts 测试） |
| `corepack pnpm db:verify` | 8 个迁移、4 个 profile/campus 函数所有权、无上下文拒绝、本人成员列表、重复申请幂等、资料更新与回滚 |
| `corepack pnpm typecheck` / `build` | 18/18 与 11/11 Turbo tasks 通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查仍通过 |

关键安全断言：

- 资料更新只使用事务本地 `app.user_id`，不接受客户端 user/principal ID。
- `aven_app` 不能直接更新 `principals`/`users`；只能执行受控函数。
- 校园申请只能创建 `pending`，不能自行设置 verified/verification_method/verified_at。
- `principals.version` 随资料更新递增，供后续预览/授权来源追溯。
- 校园列表只返回 active 校园；成员列表只返回本人。

## 已知限制

- 未实现校园管理员审核、邮件域名验证、学号/证件上传与审核证据；当前只有 pending 申请。
- 未实现组织创建/成员/邀请/角色；M2-03 负责。
- 未实现 `FORCE RLS`、跨账号/跨组织隔离集成测试；M2-04/M2-05 负责。
- 未实现 Web/Mobile 资料页面；当前只有 API 与验证脚本。
- 未验证真实设备、邮件域名、管理员权限与生产数据保留。

## 下一步

- M2-03：组织创建、成员邀请/接受、owner/admin/member、最后管理员保护。
- M2-04/M2-05：写策略、`FORCE RLS`、跨账号/跨组织隔离测试。
- 校园审核流程与真实认证信号在组织/校园管理任务中补齐。
