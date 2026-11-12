# ADR-016：引荐补充资料（Referral Supplements）、内容版本化与生命周期维护

## 状态

已接受（2026-11-12）

## 背景与问题

在 M5 匹配与引荐主线中，组织方在审阅候选人引荐时，可能提出补充资料要求（`decision = 'info_requested'`），例如要求候选人提供代码仓库链接、作品集或每周可用时长。
但在原有实现（`0023_consent_and_referrals.sql`）中：
1. 缺少申请人提交补充材料的实体和受控函数：当引荐进入 `info_requested` 状态后，申请人无法在当前引荐下提交补充材料，流程处于阻塞。
2. 缺乏内容版本化演进机制：当申请人提交补充材料后，应递增引荐的 `content_version`，将引荐状态重置为审阅状态（`sent`），并重置组织侧的决定状态（`pending`），使得组织方能够在新的内容版本（`content_version = 2, 3...`）上做出明确的接受或拒绝决定。
3. 缺少过期引荐与授权的批次维护清理（`app.maintain_referrals`）：当引荐超过 `expires_at` 时，仍停留在 `sent` 或 `info_requested` 状态，需要受控的 Worker 维护函数自动将到期未决引荐及关联的过期 `consent_grants` 批次置为 `expired` 终态。

## 决策

1. **实体与表结构 (`public.referral_supplements`)**：
   - 包含字段：`id` (uuid pk), `referral_id` (uuid fk referrals), `supplement_version` (integer), `author_user_id` (uuid fk users), `content` (text, 1..4000 字符), `created_at` (timestamptz)。
   - 唯一约束：`CONSTRAINT uq_referral_supplement_ver UNIQUE (referral_id, supplement_version)`。
   - 索引：`idx_referral_supplements_ref ON public.referral_supplements (referral_id, supplement_version ASC)`。
   - 开启 `FORCE ROW LEVEL SECURITY`。

2. **行级安全与权限边界**：
   - 查询策略（`referral_supplements_participant_select`）：仅允许该引荐的申请人（`applicant_user_id = app.current_user_id()`）或接收组织的有权成员（`organization_id = app.current_principal_id() OR app.is_org_member(organization_id)`）读取。
   - 严格禁止普通业务会话（`aven_app`）直接执行 INSERT/UPDATE/DELETE，全部写操作必须通过 `aven_function_owner` 的受控存储过程进行。

3. **受控存储过程设计**：
   - `app.submit_referral_supplement(p_referral_id uuid, p_content text, p_expected_version integer)`:
     - 校验调用者必须为该引荐的申请人。
     - 校验引荐状态必须处于 `info_requested` 或 `sent`（处于 `accepted`, `declined`, `withdrawn`, `expired` 等终态时禁止提交，抛出 22023）。
     - 检查并发乐观锁：`referrals.version = p_expected_version`（不匹配抛出 40001）。
     - 计算递增的 `supplement_version` 并写入 `public.referral_supplements`。
     - 递增 `referrals.content_version = referrals.content_version + 1`。
     - 更新 `referrals.status = 'sent'`，递增 `referrals.version = referrals.version + 1`，刷新 `updated_at`。
     - 重置组织侧决定（`referral_decisions` where side = 'organization'）：设置 `decision = 'pending'`, `reason = NULL`, `referral_content_version = new_content_version`, `decided_at = NULL`, 递增版本。
   - `app.list_referral_supplements(p_referral_id uuid)`:
     - 校验调用者身份为申请人或该组织成员，按 `supplement_version ASC` 返回所有补充材料记录。
   - `app.maintain_referrals(p_batch_size integer DEFAULT 100)`:
     - 严格限制执行身份：`SESSION_USER = 'aven_worker'`。
     - 查找已过期的待决引荐（`status IN ('sent', 'info_requested') AND expires_at <= clock_timestamp()`），批次更新为 `status = 'expired'`, `version = version + 1`。
     - 查找已过期的未决授权（`status = 'active' AND expires_at <= clock_timestamp()`），批次更新为 `status = 'expired'`, `version = version + 1`。
     - 返回统计 jsonb：`{ "expiredReferralsCount": n, "expiredGrantsCount": m }`。

4. **API 与端点定义**：
   - `POST /api/v1/referrals/:id/supplements`：申请人提交补充材料，请求体 `{ "content": "...", "expectedVersion": 1 }`。
   - `GET /api/v1/referrals/:id/supplements`：引荐双方读取补充材料记录列表。

## 结果与影响

- 彻底闭环 M5-04（“/referrals 发送/补充/决定/撤回；终态重发保留历史，内容版本与行版本分开”），M5-04 状态从 `PARTIAL` 推进为 `DONE`。
- 保证组织端在提出要求后能收到补充反馈，且在补充材料提交后重置待决状态，避免依据过时信息做出误判。
- 租户表数量推进至 61 张，全部强制行级安全（FORCE RLS）。
