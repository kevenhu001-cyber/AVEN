# 首条旅程核心端点契约

版本：1.1 · 日期：2026-11-10 · 状态：未实现；Schema 名称是待建契约，不代表已有代码
相关：[全局规范](README.md) · [TDD](../architecture/TDD.md) · [SCHEMA](../database/SCHEMA.md)

以下路径均带 `/api/v1`。个人从 Cookie/Bearer 会话派生，组织代表请求显式携带 `X-Organization-Id` 并由服务端核对路由/资源；Cookie 写请求校验 CSRF。UUID、UTC ISO 8601、字段允许列表和数量/长度上限由 Zod 校验；私人与授权响应均 `Cache-Control: private, no-store`。

## 1. POST /consents/preview

- 认证：个人；预览自己拥有且允许 sharing 的字段。接收方/用途不能由模型扩大。
- 请求 Schema：`ConsentPreviewRequest`，包含 `intent_id`、`opportunity_id`；既有引荐的补充/授权另带 `referral_id` 与 `expected_content_version`。
- `scopes` 非空，逐项为 `{purpose, fields, expires_at}`；purpose 为 referral 或 relationship_context，不允许重复用途；fields 为 `{source_type, source_id, field_key}` 的去重集合，不接收客户端实际值/actor/权限。上限每用途 30 字段、字段快照总 JSON 64 KiB，超出返回 VALIDATION_ERROR。
- 服务端取得真实源值、版本和字段策略，验证业务对象/接收组织以及资料归属；relationship_context 默认未选，不能自动补入 scopes。新引荐必须包含非空 referral 范围且机会开放；既有关系新增共享只要求关系活跃和相应权限，不因原机会已关闭而拒绝合法共享。
- 成功 200：`ConsentPreviewResponse`：`preview_id`、`preview_hash`、`expires_at`（凭据 10 分钟）、`recipient`（ID/显示名/可读代表范围）、`scopes`（用途/实际字段快照/来源版本/期限）、`not_shared`。客户端必须展示实际值与用途，不只显示字段标签。
- 副作用：仅保存短期凭据/最小来源清单，不创建授权或发送消息。预览不是披露许可。
- 失败：FORBIDDEN、NOT_FOUND、VALIDATION_ERROR、OPPORTUNITY_CLOSED/EXPIRED。输出不得含未选字段或私人来源全文。

## 2. POST /referrals

- 请求 `ReferralCreateRequest`：`{preview_id, preview_hash}`；必须 Idempotency-Key，不接收 applicant_user_id、organization_id 或客户端快照。
- 短事务锁定预览与来源，重验双方、已验证邮箱、来源/策略版本/值哈希、用途/期限、机会状态、校园与屏蔽关系；凭据单次消费。过期返回 PREVIEW_EXPIRED，任何影响预览的变化返回 PREVIEW_STALE，不能静默更新实际共享值。
- 同事务创建 referral、已确认用途的 grants/items/events、个人 accepted 决定、受控 Audit/Outbox 和幂等结果。关系用途期限从本次授权计时，不等到组织接受才开始。
- 成功 201：`ReferralResponse`，仅含 `id`、`status`、`version`、`content_version`、`opportunity_id`、`organization_id`、`sent_at`、`expires_at`、授权 ID/期限摘要；不重复嵌入私人快照。引荐期限不晚于 14 天及必需 referral 授权的可用期限。
- 同键同请求返回同一资源结果，先重验当前读取权限；同键不同内容返回 IDEMPOTENCY_CONFLICT；同一个人/机会已有活跃引荐返回 CONFLICT 并仅向有权者给出现有 ID。
- 终态重发须新预览、新引荐，保留 supersedes_referral_id，由服务端校验同一人/机会。网络超时用原键重试，不新建键绕过去重。

## 3. GET /referrals 与 GET /referrals/:id

- 申请人可读本人引荐；当前组织 owner/admin/can_represent 可读本组织已发送引荐。组织不能通过 candidate_id 读取未发送候选，也不能获得候选 evidence/reasons。
- 元数据包含状态、双方决定、内容/行版本与允许的操作；引用授权 ID 不等于返回正文。有效快照由受控读取按 referral 用途、双方、来源及有效期逐项返回 `shared_fields`；终态元数据可读不代表失效快照可读。
- 列表 cursor 绑定个人/组织、过滤与 `(sent_at,id)` 排序；limit 默认 20、最大 100。无权知晓对象返回 NOT_FOUND。

## 4. POST /referrals/:id/decisions

- 请求 `ReferralDecisionRequest`：`{decision, expected_version, expected_content_version, reason?}`；decision 为 accepted/declined/info_requested。当前首条旅程由组织侧调用，个人发送已代表接受；个人撤回用独立端点。
- 必须 Idempotency-Key；验证当前组织身份与代表权，不能提交 side、代表主体或实际执行用户。
- accepted 走 TDD 接受事务；绑定当前 content_version，重验个人决定、机会/名额、有效 referral 授权。仅将独立确认且仍有效的 relationship_context 项加入共享上下文；没有则建空上下文关系。
- 成功 200：`{referral_id, status, version, content_version, relationship_id?}`。重复接受先鉴权后返回既有关系，不因为状态已经 accepted 或之后机会关闭而再次创建/拒绝合法重放。
- declined/info_requested 不建关系；declined 同事务撤销本引荐绑定授权，info_requested 保留当前有效范围等待新预览。reason 限长 1000 字符，作为受限业务内容，不写入普通日志/事件。版本变化返回 VERSION_CONFLICT，权限丧失返回 FORBIDDEN/NOT_FOUND；授权/机会/名额错误使用专门错误码。

## 5. POST /referrals/:id/supplements 与 POST /referrals/:id/withdraw

- 补充只限申请人、info_requested 状态；请求带新 preview_id/hash、expected_version/content_version 和 Idempotency-Key。预览绑定原引荐与现有内容版本。
- 补充事务创建明确确认的新授权，旧授权替换范围明确并记录 supersedes；不能默认撤销无关独立授权。递增 content_version 与 version，更新个人接受版本、组织 pending 决定并回到 sent，旧快照不会被原地改写。
- 撤回只限本人 sent/info_requested，携带 expected_version、Idempotency-Key；原子撤回并撤销该引荐当前有效授权，保留元数据，不继续暴露快照。accepted 后使用关闭关系/撤销授权，不伪装为尚未发生。
- 成功 200 返回当前引荐元数据；重复撤回幂等。终态冲突为 REFERRAL_NOT_AVAILABLE，预览失效/版本冲突与创建端点一致。

## 6. POST /consents、GET /consents/:id 与 POST /consents/:id/revoke

- 独立创建：请求 `{preview_id, preview_hash}` + Idempotency-Key，仅绑定既有引荐/活跃关系；新引荐使用第 2 节的原子发送，不先产生悬空授权。既有关系的 relationship_context 授权与 shared_context_items 在同一事务追加，不能只建 grant 而遗漏空间绑定。成功 201 返回授权元数据。
- 查询：授权人可管理；接收方仅在当前代表权限内读取必要元数据/有效字段。撤销历史可保留，但不能通过查询接口读失效 value_snapshot。
- 撤销：请求 `{expected_version}` + Idempotency-Key；仅授权人。锁定 grant，同事务改状态、递增版本并追加元数据事件；重复撤销成功返回相同授权 ID/当前状态，不改其他独立授权。
- 成功 200：`{id, status:"revoked", version, revoked_at}`。不返回被撤销的快照，不承诺收回截图或已在途字节。

## 7. GET /relationships/:id/context

- 当前关系成员且为 grantor 或接收方当前代表才可读相应字段；普通组织成员不自动获得私人快照。
- 逐项验证共享项 active、复合 grant/item 关联、relationship_context 用途、同一引荐绑定、来源未失效、grant/item 有效与当前时钟未过期。主库短事务读取，不从只读副本/共享缓存返回。
- 成功 200：`{data:[{id, field_key, value, source_version, grant_id, expires_at}], next_cursor}`。无授权上下文为合法空列表；已知失效项可以返回不含值的状态摘要。无权知晓关系返回 NOT_FOUND，不透出成员或字段名。

## 8. Agent 创建、订阅与取消

- `POST /agent/turns`：`AgentTurnRequest` 包含 conversation_id、input、expected_context_version（如适用）；用户/组织身份服务端派生，输入上限在 M3 根据模型预算锁定。必须 Idempotency-Key；同事务保存用户输入消息、绑定 input_message_id 的 run、启动 Outbox 与幂等结果，成功 201 返回 `{run_id,status,stream_url}`。输入正文只进受保护消息存储，不进队列/日志；不直接开 SSE，不由重连重发 input。
- `GET /agent/runs/:id/events`：fetch SSE，支持 Cookie/Bearer 与 Last-Event-ID；持久事件按 `(run_id,sequence)` 去重并恢复，心跳为无 ID 注释。先重验发起用户、组织和来源/授权依赖，再重放，不能把存档当成权限豁免。
- 历史保留 24 小时；超期返回 410 EVENT_HISTORY_EXPIRED，非法游标返回 409 INVALID_EVENT_CURSOR；无权知晓 run 返回 404。出流后的失败使用 turn.failed/cancelled 安全终止事件，禁止泄露内部提示词和失效正文。
- `POST /agent/runs/:id/cancel`：必须 Idempotency-Key；终态重复取消返回当前状态，运行中请求取消返回 202，之后查询/订阅确认结果。断开订阅不是取消，取消不回滚已提交业务副作用。
- `GET /agent/runs/:id`：返回当前状态、必要结果引用与安全错误；历史过期不自动重新生成答案。客户端向用户明确“可恢复同一任务”和“需要发起新任务”的区别。

## 9. 必须交付的验证

各端点实现时补上实际 Zod Schema、完整输出示例、OpenAPI 与测试位置，不以本文证明接口可用。至少覆盖：

- 伪造个人/组织/用途/源值、跨校园、未发送候选、移除成员、低权限成员和猜测 ID。
- 预览后源值/用途变化、预览过期/重复消费、引荐终态重发、不同需求申请同一机会。
- 并发发送/接受/撤销、旧内容版本决定、幂等过期后的业务去重、幂等重放不返回撤销正文。
- 仅引荐授权时建立空上下文、错配 grant/item、绑定其他引荐、删除来源后立即拒绝。
- SSE 历史到实时切换、事件重复/缺失/超期、重放时授权丧失、取消后未提交动作停止。

当前仅契约评审，以上测试均未执行。
