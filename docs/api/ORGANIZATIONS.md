# 组织、成员与邀请 API 契约

版本：1.0 · 日期：2026-11-11 · 状态：M2-03 已实现并通过真实 HTTP/数据库验证
相关：[API 规范](README.md) · [认证与会话](AUTH.md) · [TDD](../architecture/TDD.md) · [SCHEMA](../database/SCHEMA.md)

所有路径带 `/api/v1`，需要有效会话；Web 写请求需要 `X-CSRF-Token`，Mobile 使用 Bearer。组织角色为 `owner`、`admin`、`member`；只有 `owner` 可改变成员角色，`owner`/`admin` 可邀请与移除成员。

## POST /organizations

- 认证：受保护；Web 需要 CSRF。
- 请求 `CreateOrganizationRequest`：`{name, slug, description?, type, campusId?}`。
  - `name` 1–120；`slug` 小写字母/数字/连字符，3–60；`type` 为 lab/research_group/club/department/company/other；`campusId` 必须为 active 校园。
- 成功 201 `OrganizationDetail`：创建者自动成为唯一 `owner`，`canRepresent=true`，`memberCount=1`。
- 失败：`VALIDATION_ERROR` 422、`CONFLICT` 409（slug 重复）、`FORBIDDEN` 403、`UNAUTHENTICATED` 401。
- 副作用：同一事务创建 organization principal、organizations 行与 owner membership；不自动认证组织。

## GET /organizations

- 认证：受保护。
- 成功 200 `OrganizationListResponse`：当前用户 active 成员关系，含 `role`、`status`、`canRepresent`、`joinedAt`。
- 只返回本人可见组织；非成员不返回。

## GET /organizations/:id

- 认证：受保护；必须是该组织 active 成员。
- 成功 200 `OrganizationDetail`：名称、slug、描述、类型、校园、认证状态、当前角色、代表权、active 成员数。
- 非成员/不存在返回 404，不透露组织是否存在。

## GET /organizations/:id/members

- 认证：受保护；必须是 active 成员。
- 成功 200 `OrganizationMemberListResponse`：`userId`、显示名、角色、状态、代表权、加入时间；只返回 active 成员。
- 不返回邮箱、校园审核证据或私人资料。

## POST /organizations/:id/invitations

- 认证：受保护；Web 需要 CSRF；调用者必须是 active `owner`/`admin`。
- 请求 `InviteOrganizationMemberRequest`：`{email, role:"admin"|"member"}`；不允许邀请 owner。
- 成功 201 `OrganizationInvitation`：`{id,email,role,status:"pending",expiresAt,createdAt,acceptedAt:null}`；不返回邀请 token。
- 失败：`FORBIDDEN` 403（非管理员）、`CONFLICT` 409（已是 active 成员）、`VALIDATION_ERROR` 422、`SERVICE_NOT_READY` 503（邮件未配置）。
- 副作用：创建/刷新 pending 邀请，token 只存 SHA-256，7 天有效；开发环境写入 `.data/mail`，生产邮件未配置时失败关闭。
- 重复邀请同一邮箱会刷新 pending token 与期限，不创建多条 pending。

## GET /organizations/:id/invitations

- 认证：受保护；`owner`/`admin`。
- 成功 200 `OrganizationInvitationListResponse`：邀请元数据，不含 token。
- 非管理员返回 403。

## POST /organization-invitations/accept

- 认证：受保护；Web 需要 CSRF。
- 请求 `AcceptOrganizationInvitationRequest`：`{token}`。
- 成功 200 `{organizationId,membershipId,role}`；要求当前用户邮箱已验证且与邀请邮箱一致。
- 失败：`FORBIDDEN` 403（邮箱未验证）、`VALIDATION_ERROR` 422（无效/过期/邮箱不匹配）、`NOT_FOUND` 404。
- 副作用：创建或重新激活 membership；邀请标记 accepted；重复接受返回同一 membership，不重复创建。
- 邀请邮箱不匹配不透露邀请是否存在。

## PATCH /organizations/:id/members/:userId

- 认证：受保护；Web 需要 CSRF；仅 `owner`。
- 请求 `UpdateOrganizationMemberRoleRequest`：`{role:"admin"|"member"}`。
- 成功 204；目标必须是 active 非 owner 成员。
- 失败：`FORBIDDEN` 403（非 owner）、`CONFLICT` 409（目标是 owner）、`NOT_FOUND` 404。

## DELETE /organizations/:id/members/:userId

- 认证：受保护；Web 需要 CSRF；`owner` 可移除 admin/member；`admin` 只能移除 member。
- 成功 204；目标状态改为 `removed`。
- 失败：`FORBIDDEN` 403（admin 移除 admin/非管理员）、`CONFLICT` 409（目标是 owner）、`NOT_FOUND` 404。
- 不能通过此端点移除自己；使用 leave。

## POST /organizations/:id/leave

- 认证：受保护；Web 需要 CSRF。
- 成功 204；成员状态改为 `left`。
- 最后一名 active owner 不能离开，返回 `CONFLICT` 409；所有权转让尚未实现。
- 离开不等于删除组织历史，也不撤销其他独立授权。

## PATCH /organizations/:id

- 认证：受保护；Web 需要 CSRF；调用者必须是 active `owner`/`admin`。
- 请求 `UpdateOrganizationRequest`：`{name?, description?, websiteUrl?, logoUrl?}`。
  - `name`: 1–120 字符；`description`: 最大 2000 字符；`websiteUrl`/`logoUrl`: 最大 500 字符。
- 成功 200 `OrganizationDetail`：返回更新后的组织详情；同步递增 `principals.version` 与更新 `principals.display_name`。
- 失败：`FORBIDDEN` 403（普通成员或外部访客越权）、`VALIDATION_ERROR` 422。

## GET /organizations/:id/public

- 认证：公开免登录 (`@Public()`)。
- 成功 200 `PublicOrganization`：`{id, name, slug, description, type, campusId, websiteUrl, logoUrl, verificationStatus, createdAt}`。
- 只返回组织公共资料，不泄露内部成员结构或非公开机会。

## 安全边界

- 组织函数全部为 `SECURITY DEFINER`，由 `aven_function_owner` 持有，使用事务本地 `app.user_id`；不接收客户端 actor/role 作为权限依据。
- `aven_app` 只执行函数；不能直接写 organizations/memberships/invitations/principals。
- 最后 owner 不能被移除/降级/离开；admin 不能移除 admin；非成员不能读取成员或邀请。
- 邀请 token 只存哈希；开发邮件 sink 不写日志；生产邮件 Provider 未配置时失败关闭。
- 组织认证状态与成员角色分离；创建组织不等于官方认证。

## 验收

- `corepack pnpm organization:verify`：31 项真实 HTTP/数据库检查通过。
- `corepack pnpm opportunity:verify`：包含 M4-01 组织资料修改、普通成员/访客越权拦截、公开端点访问等端到端验收检查。
- 覆盖：创建/列表/详情、非成员隔离、owner/admin/member、邀请/接受、重复邀请、邮箱不匹配、无效 token、角色变更、移除、离开、最后 owner 保护、资料更新与公开主页、重复 slug、CSRF。

