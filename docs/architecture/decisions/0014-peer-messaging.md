# ADR-014：个人连接消息契约与隐私控制

- 日期：2026-11-12
- 状态：已接受，实施于 0036 迁移
- 补充 ADR-011（个人连接）、ADR-012（保留清理）；不影响组织引荐关系空间

## 决策背景与原则

AVEN 明确对话优先与个人到个人连接。在双方通过个人连接邀请独立决定并原子建联（`peer_connections`）后，双方需具备私密、受控的会话消息收发能力。

现有 M5 的 `relationships` 与 `relationship_members` 强绑定组织机会与申请人，不适用于纯个人之间的社交连接。必须在 `peer_connections` 上建立专属的消息存储与契约。

## 数据模型与安全规则

新增表 `public.peer_messages`：
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `connection_id uuid NOT NULL REFERENCES public.peer_connections(id) ON DELETE CASCADE`
- `sender_user_id uuid NOT NULL REFERENCES public.users(id)`
- `content text NOT NULL CHECK (char_length(trim(content)) >= 1 AND char_length(content) <= 4000)`
- `client_message_id uuid NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`
- `deleted_by_sender boolean NOT NULL DEFAULT false`
- `deleted_by_recipient boolean NOT NULL DEFAULT false`
- `purged_at timestamptz`
- 约束与索引：
  - `CONSTRAINT uq_peer_messages_client_id UNIQUE (connection_id, client_message_id)`（客户端发送幂等与重复提交保护）
  - `CREATE INDEX idx_peer_messages_pagination ON public.peer_messages (connection_id, created_at DESC, id DESC)`（倒序游标分页加速）
  - `CREATE INDEX idx_peer_messages_sender ON public.peer_messages (sender_user_id)`

强制行级安全（FORCE RLS）：
- 表启用 `ENABLE ROW LEVEL SECURITY` 与 `FORCE ROW LEVEL SECURITY`。
- 普通应用角色 `aven_app` 仅有 `SELECT` 权限，策略要求：
  - 当前主体为有效个人用户（`app.current_principal_id() = app.current_user_id()`）；
  - 当前用户是该连接的 `user_low` 或 `user_high`；
  - 针对该用户未被软删除（作为发送方时 `deleted_by_sender = false`，作为接收方时 `deleted_by_recipient = false`）。
- 写入、删除及维护仅由拥有 `aven_function_owner` 权限的受控存储过程执行，禁止外部直接 DML。

## 核心业务函数

1. `app.send_peer_message(p_connection_id uuid, p_content text, p_client_message_id uuid) RETURNS jsonb`:
   - 检验调用方为有效个人用户；
   - 验证连接存在且调用方为双方之一；
   - 校验内容非空且在 1~4000 字符内；
   - 幂等判定：若 `(connection_id, client_message_id)` 已存在：
     - 若同发送者且内容完全一致，安全返回已有消息；
     - 若不同发送者或不同内容，拒绝并抛出 409 冲突；
   - 插入新消息并返回结构体。

2. `app.list_peer_messages(p_connection_id uuid, p_cursor_created_at timestamptz, p_cursor_id uuid, p_limit integer) RETURNS jsonb`:
   - 仅限连接参与者；
   - 倒序游标分页，单页上限 50（默认 20）；
   - 过滤当前用户软删除的消息；
   - 返回 `{ connectionId, messages, nextCursor }`。

3. `app.delete_peer_message(p_message_id uuid) RETURNS jsonb`:
   - 仅限参与者；
   - 若调用者为发送方，置 `deleted_by_sender = true`；
   - 若调用者为接收方，置 `deleted_by_recipient = true`；
   - 单方删除不影响另一方查看历史；
   - 返回 `{ success: true, messageId }`。

4. `app.maintain_peer_messages(p_batch_size integer) RETURNS jsonb`:
   - 仅允许真实 `aven_worker` 会话执行；
   - 扫描双方均已软删除且尚未清除的正文（`deleted_by_sender = true AND deleted_by_recipient = true AND purged_at IS NULL`）；
   - 使用 `FOR UPDATE SKIP LOCKED`，将 `content` 清空置为 `''` 并记录 `purged_at = clock_timestamp()`，彻底擦除私人正文同时保留行 ID 避免破坏游标与约束。

## 验证要求

- 完整真实端到端验证：建联、收发、幂等重放、内容截断/超长拒绝、非参与者隔离、倒序游标分页、单向软删除、双向删除 Worker 物理清除、跨账号/未认证拒绝。
