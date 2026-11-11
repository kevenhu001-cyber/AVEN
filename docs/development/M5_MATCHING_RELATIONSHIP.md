# M5 匹配、引荐、关系与撤销交付记录

日期：2026-11-11 · 状态：意向、匹配候选、用途授权预览、引荐双向决定、关系建立、关系空间共享上下文与撤销传播已实现并通过真实端到端验证；语义向量召回、Android 主线与关系会话未实现

## 范围

本轮交付首条确定性业务闭环：组织发布机会 → 个人创建意向 → 系统生成可解释候选 → 个人预览并授权共享 → 发送引荐 → 双方独立决定 → 双方接受后建立唯一关系 → 关系空间按授权快照读取共享内容 → 撤销授权后立即阻断下游读取。交付 M5-01、M5-03 至 M5-07、M5-09。未实现 M5-02 的向量语义召回与 M5-08 的 Android 主线。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0022_intents_and_matching.sql` | `intents`、`match_candidates` 表与 FORCE RLS、`app.generate_match_candidates` |
| `packages/database/migrations/0023_consent_and_referrals.sql` | `consent_previews`、`referrals`、`referral_decisions`、`consent_grants`、`consent_grant_items`、`consent_events` 与受控函数 |
| `packages/database/migrations/0024_relationships_and_sharing.sql` | `relationships`、`relationship_members`、`shared_context_items`、`app.establish_relationship` 与共享上下文读取 |
| `apps/api/src/intent/*`、`referral/*`、`relationship/*` | 意向与候选、授权预览、引荐与决定、关系建立与共享上下文、授权撤销 |
| `packages/contracts/src/index.ts` | Intent / MatchCandidate / Consent / Referral / Relationship Schema |
| `scripts/m5-journey-verify.ts` | 21 项全流程真实端到端检查 |
| `docs/api/MATCHING.md`、`REFERRALS.md`、`RELATIONSHIPS.md` | 端点契约、状态机、权限与失败语义 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm m5:verify` | **21/21 通过**；发布→意向→候选→授权预览→引荐→组织收件箱→共享快照→双方接受→原子建联→共享上下文→撤销→即时阻断→关闭关系 |
| `corepack pnpm isolation:verify` | **21/21 通过**（回归）；跨账号、跨组织、伪造主体头、成员移除、连接池上下文 |
| `corepack pnpm db:verify` | **184 项数据库检查通过**（含 24→29 个迁移、授权与关系表约束） |
| `corepack pnpm test` | **140/140 通过** |
| `corepack pnpm typecheck` / `lint` / `build` | 全部通过 |

关键安全断言：

- 候选只有本人可读，组织在引荐发送前读不到候选内容。
- 授权预览绑定本人、机会、接收组织、用途范围与内容哈希快照，短期有效；预览本身不产生授权。
- 引荐的双方决定独立记录并绑定内容版本；只有双方接受才允许建立关系。
- 关系建立是单事务操作，并在事务内复核机会可用性、成员权限、双方决定与授权有效性；唯一约束防止重复空间。
- 共享上下文只读取状态为 `active`、父授权未撤销未过期的条目；未确认时共享上下文为空。
- 撤销授权后，关系共享上下文在同一次读取中即被阻断（不是等缓存过期）。
- 授权读取在主库核对用途、业务对象、来源状态与期限；撤销后新检查直接拒绝。
- 引荐用途不升级为关系用途。

## 已知限制

- **M5-02 未完成向量语义召回**：当前 `v1` 为确定性结构化特征打分，仓库中没有 pgvector 列或 embedding 表，`featureScores`/`reasons` 不是语义相似度。
- **M5-08 未完成 Android 主线**：无 Android SDK、未做 development build 真机验证；`apps/mobile` 只有首页骨架，没有登录、意向、引荐或关系页面。
- 关系空间没有会话与消息 API（`conversations` / `messages` 表存在但未接线）。
- 引荐补充资料（`supplements`）没有独立接口与界面。
- 授权到期扫描与 `stale` 标记没有定时任务；撤销即时生效，到期则依赖读取时的到期判断。
- 没有 Web/Mobile 的意向、候选、引荐与关系页面（受 M1-07 设计评审门阻塞）。

## 下一步

- M1-07 正式双端设计评审 → 解锁个人页面与组件层编码。
- 语义召回：pgvector 迁移、向量维度与重排序评估（需先确认 Provider 与部署环境）。
- M5-08：development build 主线与 Android 旅程验收。
- 关系会话与通知（依赖 M6-06）。
