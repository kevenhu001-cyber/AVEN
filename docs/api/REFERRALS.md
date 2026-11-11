# 引荐与授权 API

适用里程碑：M5-03、M5-04、M5-07。契约来源：`packages/contracts/src/index.ts` 中的 `Consent*`、`Referral*` Schema。

端点位于 `/api/v1`，需要会话；写操作需要 CSRF。引荐与授权用途严格分离：引荐用途不自动升级为关系用途。

## 1. 授权预览（Consent Preview）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/consents/previews` | 生成短期授权预览，供用户确认将要共享的内容 |

请求（`CreateConsentPreviewRequestSchema`）：

```json
{
  "opportunityId": "…",
  "intentId": "…",
  "purposeScopes": {
    "referral": { "fields": ["display_name", "skills", "bio"], "expiresInDays": 14 }
  }
}
```

- 预览绑定本人、机会、接收组织、用途范围与 `payload_hash` 快照，短期到期后失效。
- 预览只是"将要共享什么"的说明，**不是授权本身**；真正授权在引荐建立时落库。

## 2. 引荐（Referral）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/referrals` | 用预览创建引荐，body `{ "previewId": "…", "candidateId": "…" }` |
| `GET` | `/api/v1/referrals/me` | 本人发出的引荐 |
| `GET` | `/api/v1/organizations/:id/referrals` | 组织收到的引荐（仅本组织有权成员） |
| `GET` | `/api/v1/referrals/:id` | 引荐详情 |
| `GET` | `/api/v1/referrals/:id/shared-snapshot` | 按授权快照读取共享内容 |
| `POST` | `/api/v1/referrals/:id/decisions` | 发起方或组织方作出决定 |
| `POST` | `/api/v1/referrals/:id/withdraw` | 发起方撤回 |
| `POST` | `/api/v1/consents/grants/:id/revoke` | 撤销授权 |

### 2.1 状态机

引荐状态：`sent → info_requested → accepted | declined`，另有 `withdrawn`、`expired` 终态。

- 双方各自记录决定（`referral_decisions`，`applicant` / `organization` 两侧独立），决定绑定 `referral_content_version`。
- 只有双方都接受才允许建立关系（见 [关系 API](RELATIONSHIPS.md)）。
- 终态后再次发送会保留历史并建立新的引荐记录，不覆盖旧决定。
- `content_version`（共享内容版本）与 `version`（引荐记录版本）分开管理。

### 2.2 决定请求

```json
{ "decision": "accepted", "reason": "可安排面谈", "expectedVersion": 1 }
```

`decision` 取值：`accepted` / `declined` / `info_requested`。版本不一致返回 409。

### 2.3 共享快照

`GET /api/v1/referrals/:id/shared-snapshot` 只返回授权范围内的字段：

- 读取时重新核对授权状态、来源版本与期限，不依赖调用时的旧快照。
- 授权被撤销后立即返回空结果，不返回已缓存内容。
- 组织在引荐**未发送**前无法读取候选内容。

## 3. 授权撤销

`POST /api/v1/consents/grants/:id/revoke`，body `{ "reason": "…" }`。

- 只有授权人（grantor 本人）可以撤销；重复撤销幂等。
- 撤销写入 `consent_events` 审计（`revoked` 事件，含必要元数据，不含私人正文）。
- 撤销后新的授权读取立即被拒绝；关系共享上下文通过 `app.get_relationship_shared_context` 实时复核，同样立即失效。
- 已通过检查的在途字节与外部副本无法收回，撤销只约束后续读取。

## 4. 权限与失败

| 场景 | 结果 |
|---|---|
| 非本组织成员读取组织引荐 | 403 |
| 读取他人引荐 | 404 |
| 预览过期后创建引荐 | 409 |
| 版本冲突的决定 | 409 |
| 撤销他人授权 | 403 |
| 撤销不存在的授权 | 404 |

## 5. 验证记录

- `corepack pnpm m5:verify`：预览快照、范围限制、引荐创建、组织收件箱、共享快照读取、双方接受、授权撤销后共享上下文即时阻断等真实 HTTP/数据库检查通过。
- `corepack pnpm isolation:verify`：跨账号/跨组织隔离与连接池上下文检查通过。

## 6. 未实现

- 引荐补充资料（`supplements`）的独立接口与界面。
- 授权到期扫描任务与 `stale` 标记的自动执行。
- 站内/邮件通知（依赖 M6-06）。
