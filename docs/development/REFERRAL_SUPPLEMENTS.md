# M5-04 交付记录：引荐补充资料（Referral Supplements）、内容版本化与生命周期维护

日期：2026-11-12。仅开发数据；没有完成生产人工审核后台、移动补充资料交互 UI 或外部邮件系统。

## 本轮结果

- 交付引荐补充资料（Referral Supplements）接口：
  - `POST /api/v1/referrals/:id/supplements`：申请人（`applicant_user_id`）针对进入补充信息阶段（`info_requested`）或在途阶段（`sent`）的引荐提交补充资料（1-4000 字符），支持并发版本乐观锁（`expectedVersion`）。
  - `GET /api/v1/referrals/:id/supplements`：参与双方（申请人及接收组织有权限成员）查看该引荐的完整补充资料版本链。
- 内容版本化（Content Versioning）与决策重置：
  - 引荐引入独立的 `content_version` 计数器，创建初始为 1。
  - 每当申请人成功提交一份补充资料：
    - `content_version` 自动递增（1 -> 2 -> 3...）；
    - 引荐状态自动流转回 `sent`；
    - 接收组织的已有决定自动重置为 `pending`，且绑定的 `referral_content_version` 更新为新的内容版本，要求组织根据最新的补充材料重新审核；
    - 引荐记录的 `version` 递增以保证并发乐观锁安全。
- 状态机终态保护：
  - 当引荐进入终态（`accepted`、`declined`、`withdrawn`、`expired`）后，拒绝任何新的补充资料提交（409 Conflict）。
- 权限与行级安全（FORCE RLS）：
  - 核心存储表 `public.referral_supplements` 启用并强制执行 `FORCE ROW LEVEL SECURITY`。
  - 申请人与接收组织成员基于参与身份只读，外部人员完全不可见（403 Forbidden）。
  - 普通业务角色（`aven_app`）无直接 INSERT/UPDATE/DELETE 权限，全流程通过 `aven_function_owner` 的受控存储过程 `app.submit_referral_supplement` 执行。
- 后台生命周期维护（Worker-only Maintenance）：
  - 实现存储过程 `app.maintain_referrals(p_batch_size)`。
  - 批量自动将超期未处理的在途引荐（`expires_at <= now()`）更新为 `expired` 状态。
  - 批量自动将超期的授权（`consent_grants.expires_at <= now()`）更新为 `expired` 状态。
  - 函数权限严格限定于 `aven_worker` 与 `aven_migrator`，业务角色 `aven_app` 无执行权限。

## 文件、架构与数据库/API

| 路径 | 变化 |
|---|---|
| `docs/architecture/decisions/0016-referral-supplements-and-lifecycle.md` | ADR-016：定义补充资料数据模型、内容版本递增、组织重置逻辑与后台维护策略 |
| `docs/api/REFERRALS.md` | 补充资料提交/列表 API 端点契约、状态流转与权限说明 |
| `packages/database/migrations/0038_referral_supplements.sql` | `referral_supplements` 表定义、FORCE RLS、`submit_referral_supplement`、`list_referral_supplements`、`maintain_referrals` 函数 |
| `packages/database/src/{schema,index,verify}.ts` | Drizzle 表定义、迁移计数推进至 38、租户表总数达 61（58 public + 3 app）、184 项全量验证 PASS |
| `packages/contracts/src/index.ts` / `referral-supplements.test.ts` | 补充资料请求/响应 Zod 契约、5 项契约单元测试 |
| `packages/api-client/src/referrals.ts` / `referrals.test.ts` | 客户端 `submitSupplement`、`listSupplements`、`createPreview`、`createReferral`、`decideReferral` 等方法与 3 项单元测试 |
| `packages/api-client/src/index.ts` | 挂载 `referrals` 客户端 |
| `apps/api/src/referral/referral.{controller,service}.ts` | NestJS 控制器新增补充资料路由与服务实现 |
| `scripts/referral-supplements-verify.ts` | 端到端 25 项全量业务与安全断言验证 |
| `package.json` | 增加 `pnpm supplements:verify` 脚本 |

## 实际验证

| 命令 | 结果 |
|---|---|
| `corepack pnpm supplements:verify` | 25/25 检查通过（账号注册、组织机会发布、意向引荐、申请补充资料、外部人员拦截、版本冲突校验、内容版本递增、组织重置待审、双方查询、终态拦截、原子关系建立、Worker 批量超期维护、直接写库阻断） |
| `corepack pnpm m5:verify` | 21/21 通过（M5 完整业务链路回归无误） |
| `corepack pnpm connections:verify` | 74/74 通过（个人连接业务回归无误） |
| `corepack pnpm notifications:verify:events` | 18/18 通过（活动通知回归无误） |
| `corepack pnpm m6:verify` | 37/37 通过（M6 日程与活动协调回归无误） |
| `corepack pnpm isolation:verify` | 21/21 通过（多租户跨组织隔离无误） |
| `corepack pnpm db:verify` | 184/184 通过（38 个迁移、61 张租户表全部 FORCE RLS） |
| `corepack pnpm test` | 30 个测试文件、235/235 单测通过 |
| `corepack pnpm check:readiness` | API/Worker 探针正常、0038 就绪门通过 |
| `corepack pnpm lint` | ESLint 0 警告 0 报错；depcruise 134 模块 417 依赖 0 违规 |
| `corepack pnpm format:check` | Prettier 代码风格校验 100% 通过 |

## 命令与运行边界

```bash
corepack pnpm supplements:verify
corepack pnpm m5:verify
```
