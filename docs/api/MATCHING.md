# 匹配候选 API

适用里程碑：M5-01、M5-02。契约来源：`packages/contracts/src/index.ts` 中的 `Intent*`、`MatchCandidate*` Schema。

所有端点位于 `/api/v1`，需要会话 Cookie（Web）或 `Authorization: Bearer <session-token>`（Mobile）。写操作需要 CSRF 头或移动端会话令牌。跨账号访问返回 404，不泄露资源存在性。

## 1. 意向（Intent）

个人用意向描述"我在找什么"，意向只属于本人，不进入组织可见范围。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/intents` | 创建意向，初始状态 `draft` |
| `GET` | `/api/v1/intents/me` | 本人意向列表 |
| `GET` | `/api/v1/intents/:id` | 意向详情，仅本人 |
| `PATCH` | `/api/v1/intents/:id` | 更新意向，必须带 `expectedVersion` |
| `POST` | `/api/v1/intents/:id/status` | 状态流转 `draft → active → paused/closed` |

创建请求（`CreateIntentRequestSchema`，严格模式）：

```json
{
  "title": "寻找具身智能方向科研合作",
  "description": "希望参与机器人操作方向的项目，本科背景，有视觉方向经验",
  "domains": ["机器人", "计算机视觉"],
  "desiredStages": ["research"],
  "locationPreference": "西安",
  "remoteOk": false,
  "commitmentHoursPerWeek": 10,
  "deadline": "2026-12-31T00:00:00.000Z"
}
```

- `desiredStages` 取值见 `OpportunityStageSchema`。
- `commitmentHoursPerWeek` 为 `1–40` 的整数或 `null`（表示不限）。
- `deadline` 为 ISO 时间或 `null`。
- 所有写接口使用乐观锁：`expectedVersion` 与当前版本不一致返回 409，不静默覆盖。

## 2. 匹配候选（MatchCandidate）

候选由本人触发生成，只有本人可读；组织在引荐发送前不能读取候选。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/intents/:id/matches/generate` | 生成/刷新候选，body `{ "algorithmVersion": "v1" }` |
| `GET` | `/api/v1/intents/:id/matches` | 列出该意向的候选 |
| `POST` | `/api/v1/matches/:id/dismiss` | 本人忽略候选，状态置为 `dismissed` |

候选字段（`MatchCandidateSchema`）：

| 字段 | 说明 |
|---|---|
| `id` / `intentId` / `opportunityId` | 候选标识与业务对象 |
| `algorithmVersion` | 算法版本，当前为 `v1` |
| `score` | `0–1` 的综合分，可为 `null`（信息不足时不猜测） |
| `featureScores` | 各维度特征分（按维度展开） |
| `reasons` | 面向用户的推荐原因 |
| `evidence` | 解释所引用的证据 |
| `status` | `active` / `stale` / `dismissed` |
| `computedAt` / `expiresAt` | 计算时间与候选有效期 |

### 2.1 算法边界（当前实现）

- 当前 `v1` 为**确定性特征打分**：领域、阶段、期限、投入时间、地点与可见范围等结构化条件参与过滤与排序。
- **尚未实现向量语义召回**：仓库中没有 pgvector 列或 embedding 表，`featureScores`/`reasons` 来自结构化特征，不是语义相似度。
- 解释中的每一项都对应允许使用的证据；候选不携带未获授权的私人字段。

## 3. 权限与失败

| 场景 | 结果 |
|---|---|
| 读取他人意向或候选 | 404 |
| 意向版本过期 | 409 CONFLICT |
| 意向未处于 `active` | 不生成新候选（返回业务错误） |
| 无可见机会 | 返回空候选列表，不编造推荐 |

## 4. 验证记录

- `corepack pnpm m5:verify`：意向创建、列表、更新、状态机、候选生成与解释、候选隔离等真实 HTTP/数据库检查通过。
- 数据库级检查见 `packages/database/src/verify.ts`（`intents`/`match_candidates` 表 FORCE RLS、约束与函数边界）。

## 5. 未实现

- 向量语义召回与重排序（pgvector 迁移未落地）。
- 候选过期扫描任务与索引清理。
- 移动端与 Web 的意向/候选页面（受 M1-07 设计评审门阻塞）。
