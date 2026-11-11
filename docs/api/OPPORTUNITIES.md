# 机会（Opportunities）生命周期 API 契约

版本：1.0 · 日期：2026-11-11 · 状态：M4-01 / M4-02 已实现并通过端到端与数据库全链路验证
相关：[API 规范](README.md) · [组织与成员](ORGANIZATIONS.md) · [认证与会话](AUTH.md) · [SCHEMA](../database/SCHEMA.md)

所有接口路径以 `/api/v1` 开头。机会管理接口要求具有组织的管理员权限（`owner` 或 `admin`，或拥有组织代表权 `can_represent`）；写请求严格启用 CSRF 防护与乐观并发版本锁（`expectedVersion`）。发现与详情接口支持游客匿名与多级可见性隔离。

---

## 1. 核心枚举与模型

- **Stage（阶段）**：`undergraduate`（本科）、`master`（硕士）、`phd`（博士）、`postdoc`（博士后）、`any`（不限）。
- **Status（状态）**：`draft`（草稿）、`open`（招募中）、`paused`（暂停中）、`closed`（已关闭，终态）、`expired`（已截止）。
- **Visibility（可见性）**：`organization`（仅组织内）、`campus`（同校学生/认证成员可见）、`public`（全网公开）。
- **并发控制**：机会表具有单调递增的 `version` 整数。更新、发布、暂停、关闭等写操作必须提交 `expectedVersion`，若版本过期返回 `409 CONFLICT`。

---

## 2. 组织内部管理接口

### POST /organizations/:id/opportunities
- **认证**：受保护；Web 需要 CSRF；调用者必须具有组织的 `owner`/`admin` 或代表权。
- **请求 `CreateOpportunityDraftRequest`**：
  ```json
  {
    "title": "具身智能抓取课题助理",
    "summary": "开展触觉感知与灵巧手策略研究",
    "description": "详细科研任务要求...",
    "domains": ["机器人", "强化学习"],
    "requirements": ["Python", "PyTorch"],
    "stage": "undergraduate",
    "commitmentHoursPerWeek": 15,
    "location": "创新港巨构 3 号 3012",
    "remoteOk": false,
    "headcount": 2,
    "deadline": "2026-12-31T23:59:59Z",
    "visibility": "campus",
    "contactUserId": "00000000-0000-4000-8000-000000000001"
  }
  ```
- **约束**：
  - `contactUserId` 若提供，必须是当前组织内的 active 成员（否则返回 `422 VALIDATION_ERROR`）。
  - `title` 1–200 字符；`summary` 1–2000 字符；`description` 1–20000 字符；`headcount` 1–100；`commitmentHoursPerWeek` 1–40。
  - 校园可见性（`campus`）要求组织绑定了有效的 `campus_id`。
- **成功 201 `OpportunityDetail`**：初始状态为 `draft`，初始 `version` 为 1。
- **失败**：`403 FORBIDDEN`（非管理员）、`422 VALIDATION_ERROR`、`404 NOT_FOUND`。

### GET /organizations/:id/opportunities
- **认证**：受保护；必须是该组织 active 成员。
- **成功 200 `OpportunityListResponse`**：返回该组织发布及起草的全部机会列表（包含 `draft`、`paused`、`closed`），按创建时间倒序排列。

### PATCH /organizations/:id/opportunities/:opportunityId
- **认证**：受保护；Web 需要 CSRF；管理员权限。
- **请求 `UpdateOpportunityRequest`**：包含 `expectedVersion: number` 以及可选修改的字段。
- **成功 200 `OpportunityDetail`**：`version` 递增。
- **失败**：
  - `409 CONFLICT`：版本号不一致（stale version）。
  - `422 VALIDATION_ERROR`：已关闭的机会（`closed`）不可再更新。

### POST /organizations/:id/opportunities/:opportunityId/publish
- **认证**：受保护；Web 需要 CSRF；管理员权限。
- **请求 `OpportunityLifecycleActionRequest`**：`{ "expectedVersion": number }`。
- **成功 200 `OpportunityDetail`**：
  - 状态变为 `open`，记录 `published_at`（首次发布时），`version` 递增。
  - 支持从 `draft` 或 `paused` 状态发布/恢复开放。
- **失败**：`409 CONFLICT`（版本冲突）、`422 VALIDATION_ERROR`（终态 closed 无法发布、过期机会不可发布）。

### POST /organizations/:id/opportunities/:opportunityId/pause
- **认证**：受保护；Web 需要 CSRF；管理员权限。
- **请求 `OpportunityLifecycleActionRequest`**：`{ "expectedVersion": number }`。
- **成功 200 `OpportunityDetail`**：状态转为 `paused`，`version` 递增。仅 `open` 状态机会可暂停。

### POST /organizations/:id/opportunities/:opportunityId/close
- **认证**：受保护；Web 需要 CSRF；管理员权限。
- **请求 `OpportunityLifecycleActionRequest`**：`{ "expectedVersion": number }`。
- **成功 200 `OpportunityDetail`**：状态转为 `closed`，记录 `closed_at`，`version` 递增。
- **幂等性**：对已处于 `closed` 状态的机会重复调用 close 返回 200 保持关闭，不报错。

---

## 3. 公开与校园发现接口

### GET /opportunities/:id
- **认证**：支持公开免登录（`@OptionalAuth()` 可选认证）。
- **权限与可见性隔离**：
  - `draft`：仅组织内部成员可读取；外部人员一律返回 `404 NOT_FOUND`（不透露存在）。
  - `campus`：仅同校认证成员（拥有对应 `campus_id` 的 verified `campus_memberships`）或组织成员可读取；外部访客返回 `404 NOT_FOUND`。
  - `public`：全网任何访客或登录用户均可读取。
- **动态到期判定**：若机会 `status = 'open'` 但当前系统时间已超过 `deadline`，查询接口动态将其映射为 `expired` 状态返回。

### GET /opportunities
- **认证**：公开免登录（`@OptionalAuth()`）。
- **查询参数**：
  - `campusId`：按校园 ID 过滤。
  - `stage`：按学生阶段过滤（`undergraduate` | `master` | `phd` | `postdoc` | `any`）。
  - `domain`：按标签/专业领域匹配（PostgreSQL GIN 数组交集匹配）。
- **过滤规则**：
  - 仅返回 `status = 'open'` 且未过截止时间（`deadline IS NULL OR deadline > now()`）的机会。
  - 未登录访客仅展示 `visibility = 'public'` 机会。
  - 已认证同校用户在筛选对应校园时，可同时看到本校专属（`campus`）和全网公开（`public`）机会。

---

## 4. 后台维护任务

- **脚本**：`scripts/opportunity-maintenance.ts` (`pnpm opportunity:maintain`)
- **功能**：调用数据库存储函数 `app.expire_due_opportunities()`，批量将超过截止时间（`deadline <= now()`）且状态为 `open` 的机会更新为 `expired`，并同步更新版本。
- **输出**：`{"expiredOpportunities": count}`。

---

## 5. 安全保障与数据库隔离

1. **FORCE ROW LEVEL SECURITY**：
   - `opportunities` 表启用并强制执行 RLS（`FORCE ROW LEVEL SECURITY`）。
   - 未授权连接（`aven_app`）禁止直接执行 `INSERT`、`UPDATE`、`DELETE`。
   - 所有数据变更必须通过拥有者为 `aven_function_owner` 的 `SECURITY DEFINER` 存储函数执行。
2. **所有权隔离**：
   - 依赖 `app.is_org_admin()` 与 `app.can_represent()`，基于当前会话用户的上下文严格判定。
   - 绝不允许客户端篡改组织 ID、创建者 ID 或机会状态。
3. **闭环状态机**：
   ```mermaid
   stateDiagram-v2
     [*] --> draft: 创建草稿
     draft --> open: publish
     open --> paused: pause
     paused --> open: publish
     open --> closed: close
     paused --> closed: close
     open --> expired: 超过截止时间 (动态或维护任务)
     closed --> [*]: 终态不可逆
   ```

---

## 6. 自动化验收

- **端到端 HTTP 测试**：`pnpm opportunity:verify`
  - 涵盖 24 项真实测试断言：组织资料修改、公开上下文、权限控制、草稿隔离、联系人归属检查、版本并发冲突拦截（409）、状态流转、可见性跨校隔离、CSRF 保护、动态到期与发现列表。
- **数据库合规测试**：`pnpm db:verify`
  - 涵盖存储函数归属、RLS 策略、非特权角色拒绝直接写入等 9 项专项断言。
