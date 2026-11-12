# ADR-015: 用户拉黑（Block）、违规举报（Report）与连接邀请限流

## 状态
已接受 (Accepted)

## 上下文 (Context)
在 AVEN 从开发环境走向真实校园/试点准入（Pilot Access）的过程中，必须具备基本的个人安全防护机制：
1. **个人拉黑 (User Blocking)**：
   - 用户有权主动单向拉黑其他用户，防止骚扰。
   - 被拉黑与拉黑关系需双向生效阻断：当用户 A 拉黑用户 B，无论由 A 向 B 还是 B 向 A，均立即阻断连接邀请发送、私聊消息发送，以及忙闲/活动等协同交互。
   - 用户可随时查看自己的黑名单列表并解除拉黑。
2. **违规举报 (Content/User Reporting)**：
   - 用户可对违规用户、违规点对点消息、骚扰性邀请或违规活动发起举报。
   - 包含举报类型（target_type）、目标 ID（target_id）、违规原因分类（spam, harassment, inappropriate_content, privacy_violation, other）与详细说明。
   - 隐私与隔离：普通用户仅能查看自己提交的举报记录；严禁将举报细节与敏感举报人身份泄露给被举报方。
3. **连接邀请限流 (Connection Invitation Rate Limiting)**：
   - 防止恶意或失控脚本/自动化批量发送连接邀请骚扰用户。
   - 在数据库原子建联层 `app.send_connection_invitation` 限制单个用户在过去 24 小时内的最大邀请发起量（默认 20 条/24h）。

## 决策 (Decisions)

### 1. 数据库模型与强制行级安全 (FORCE RLS)
- **`public.block_lists`** 表：
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`
  - `blocked_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`
  - `reason text NULL`
  - `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`
  - 约束：
    - `UNIQUE (owner_user_id, blocked_user_id)`
    - `CHECK (owner_user_id <> blocked_user_id)`（禁止拉黑自己）
  - 策略：`FORCE ROW LEVEL SECURITY`。`block_lists_owner_select` 仅允许所有者读取自己的黑名单。
- **`public.reports`** 表：
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `reporter_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`
  - `target_type text NOT NULL CHECK (target_type IN ('user', 'peer_message', 'connection_invitation', 'event'))`
  - `target_id uuid NOT NULL`
  - `reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate_content', 'privacy_violation', 'other'))`
  - `details text NULL`（最长 1000 字符）
  - `status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed'))`
  - `resolution text NULL`
  - `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`
  - `resolved_at timestamptz NULL`
  - 策略：`FORCE ROW LEVEL SECURITY`。`reports_reporter_select` 仅允许举报人读取自己提交的记录。

### 2. 受控存储过程与安全边界
所有写入与核心读操作均通过 `SECURITY DEFINER` 函数执行，所有者为 `aven_function_owner`，授予 `aven_app` 执行权限：
- `app.block_user(p_blocked_user_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb`
  - 校验调用者身份与目标用户有效性，禁止拉黑自己，幂等插入或更新黑名单。
- `app.unblock_user(p_blocked_user_id uuid) RETURNS boolean`
  - 移除指定用户的拉黑记录。
- `app.list_blocks() RETURNS jsonb`
  - 返回调用者拉黑的所有用户 ID、原因与拉黑时间。
- `app.is_blocked(p_user_a uuid, p_user_b uuid) RETURNS boolean`
  - 内部判定函数：如果 A 拉黑了 B，或 B 拉黑了 A，返回 `true`；否则返回 `false`。
- `app.submit_report(p_target_type text, p_target_id uuid, p_reason text, p_details text DEFAULT NULL) RETURNS jsonb`
  - 验证参数有效性后创建举报单，初始状态为 `open`。
- `app.list_my_reports() RETURNS jsonb`
  - 返回调用者提交的历史举报列表。

### 3. 跨模块双向交互阻断
- **连接邀请 (`app.send_connection_invitation`)**：
  - 校验 `IF app.is_blocked(u, v.recipient_user_id) THEN RAISE EXCEPTION 'cannot send invitation: user is blocked' USING ERRCODE='42501'; END IF;`。
  - 24 小时限流校验：`SELECT count(*) FROM public.connection_invitations WHERE sender_user_id = u AND created_at > clock_timestamp() - interval '24 hours'`；超过 20 条抛出异常（ERRCODE `23514`）。
- **点对点私聊消息 (`app.send_peer_message`)**：
  - 获取连接另一方用户 ID `v_other`。
  - 校验 `IF app.is_blocked(u, v_other) THEN RAISE EXCEPTION 'cannot send message: user is blocked' USING ERRCODE='42501'; END IF;`。

## 影响 (Consequences)
- 租户表数量增加 2 张（`block_lists`、`reports`），总计 60 张，全部强制开启 RLS。
- 迁移序号推进至 `0037_user_blocks_and_reports`。
- 保证个人试点准入具备反骚扰、反刷屏与违规上报闭环。
