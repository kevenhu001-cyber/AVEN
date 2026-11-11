# 个人资料与校园身份 API 契约

版本：1.0 · 日期：2026-11-11 · 状态：M2-02 已实现并通过真实 HTTP/数据库验证
相关：[API 规范](README.md) · [认证与会话](AUTH.md) · [TDD](../architecture/TDD.md) · [SCHEMA](../database/SCHEMA.md)

所有路径带 `/api/v1`，需要有效会话。Web 写请求需要 `X-CSRF-Token`；Mobile 使用 Bearer。响应 `Cache-Control: no-store`。

## PATCH /me

- 认证：受保护；Web 需要 CSRF。
- 请求 `UpdateProfileRequest`：至少一个字段：
  - `displayName`：trim 后 1–120 字符。
  - `locale`：BCP 47/Intl 可解析，2–35 字符。
  - `timezone`：IANA 时区，1–64 字符。
- 成功 200 `MeResponse`：返回更新后的用户与会话信息。
- 失败：`VALIDATION_ERROR` 422（空请求、非法 locale/timezone/显示名）、`FORBIDDEN` 403（缺失/错误 CSRF）、`UNAUTHENTICATED` 401。
- 副作用：事务内通过 `app.update_my_profile` 更新 `principals.display_name`、`users.locale/timezone`，并递增 `principals.version`；不接收客户端 user/principal ID。
- 邮箱、校园认证状态、组织角色不能通过本端点修改。

## GET /campuses

- 认证：受保护。
- 成功 200 `CampusListResponse`：`{data:[{id,name,slug,city,country}]}`，仅返回 `status=active` 的校园。
- 校园列表不是认证；不返回成员状态或私人信息。

## GET /me/campus-memberships

- 认证：受保护。
- 成功 200 `CampusMembershipListResponse`：`{data:[{id,campusId,campusName,status,verificationMethod,verifiedAt,createdAt}]}`。
- 只返回当前用户自己的校园成员关系；`status` 为 pending/verified/rejected/revoked。
- 不返回证件、学号或审核证据。

## POST /me/campus-memberships

- 认证：受保护；Web 需要 CSRF。
- 请求 `RequestCampusMembership`：`{campusId}`。
- 成功 200 `CampusMembership`：首次创建为 `pending`；重复请求返回同一成员关系，不重置状态、不自动验证。
- 失败：`VALIDATION_ERROR` 422（校园不存在/非 active）、`FORBIDDEN` 403、`UNAUTHENTICATED` 401。
- 副作用：通过 `app.request_campus_membership` 在当前用户上下文插入 pending；不能自行设置 verified、verification_method 或 verified_at。
- 校园认证审核、邮件域名验证与管理员流程在后续任务实现；当前只允许申请。

## 安全边界

- `app.update_my_profile`、`app.list_my_campus_memberships`、`app.request_campus_membership` 均为 `SECURITY DEFINER`，由 `aven_function_owner` 持有，使用事务本地 `app.user_id`，不接受客户端主体 ID。
- `aven_app` 只执行函数；不能直接更新 `principals`/`users`，也不能自行把校园成员改为 verified。
- 校园成员状态与校园认证是认证信号，不自动等同官方身份；组织/平台审核流程另行实现。

## 验收

- `corepack pnpm profile:verify`：16 项真实 HTTP/数据库检查通过。
- 覆盖：资料更新与版本递增、`me` 反映更新、校园列表、空成员列表、pending 申请、重复申请幂等、缺失 CSRF、非法时区/显示名、未知校园。
- 未验证：管理员审核、邮件域名验证、真实证件/学号流程、组织成员、`FORCE RLS`、真实设备。
