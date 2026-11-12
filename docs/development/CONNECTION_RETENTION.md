# P2P-03 正文保留清理与系统计划复核

日期：2026-11-12。仅开发数据；没有完成产品 UI、自动调度、通知或真实 AI。

## 本轮结果

- 个人预览过期满 24 小时后清空 manifest，保留预览、邀请、幂等键和已建立连接元数据。
- 个人邀请授权项首次失效满 30 天后清空正文，记录 purged_at，追加不含正文的系统清理事件。部分失效仅清理相应项，仍有效的独立项不被误清。
- 普通用途收紧与来源失效记录首次失效时间。维护还会检查授权到期/撤销、来源状态/策略与双方状态，不依赖记忆维护先运行。
- 修复来源自然到期、记忆维护尚未运行时延长有效期可能恢复旧共享的边界；恢复共享需要重新预览和新邀请。
- 保留已发送预览的幂等重放；正文清除不改变邀请版本/业务状态或已建立连接。清除与失效不可复活，也不能替换历史快照正文。
- 只有实际 aven_worker 会话能调用受控函数；固定保留窗、1–1000 批次、SKIP LOCKED 与重复/并发安全，输出只有计数。

## 文件、架构与数据库/API

| 路径 | 变化 |
|---|---|
| `packages/database/migrations/0033_connection_retention.sql` | 增加预览 purged_at、授权项 invalidated_at、保留索引、保守回填、三个守卫/失效触发器、Worker 维护函数和最小权限 |
| `packages/database/src/{schema,index,verify}.ts` | Drizzle 字段、就绪门 0033、33 个迁移检查；52 张租户表的 FORCE RLS 不变 |
| `packages/contracts/src/index.ts` / `connection-maintenance.test.ts` | 批次边界与仅计数响应校验，9 项单测 |
| `scripts/connections-maintenance.ts` / `connections-maintenance-verify.ts` | 显式维护命令与 37 项真实数据库检查；无私人正文日志 |
| `scripts/db-verify.mjs` / `scripts/fixtures/connection-retention-*.sql` | 升级至 0032 后插入开发旧数据，再升级 0033；校验未知 stale 时间从迁移开始、有效项及正文不被提前清除，最后删除夹具 |
| `scripts/connections-verify.ts` | 新增三项真实 HTTP 到期/延长回归，当前共 74 项 |
| `package.json` / `.env.example` | 维护、验证命令及批次参数示例 |
| `.github/workflows/ci.yml` | 增加个人连接、保留清理、M5、M6 实际命令；尚未在 GitHub Actions 实跑 |
| `docs/architecture/decisions/0012-connection-retention.md`、API/SCHEMA/TDD | 固定保留、不可复活、用途隔离和元数据边界 |
| README / AGENTS / 开发计划 / `SYSTEM_STATUS.md` | 复核全系统缺口、纠正整包状态与下一步顺序 |

未修改已应用迁移；0033 已应用本地开发库，隔离库已执行空库/旧版本/含旧快照升级及迁移幂等检查。本轮没有新增 HTTP 端点，现有 API 返回形状不变。清理只处理 connection_invitation，不扩大 Worker 读取正文或普通用户全库操作权限。

## 实际验证

| 命令 | 结果 |
|---|---|
| `corepack pnpm db:verify` | 原有 184 项数据库检查与旧数据升级断言通过；33 个迁移、52 张租户表 FORCE RLS、seed/迁移幂等 |
| `corepack pnpm db:migrate` | 开发库应用 0033 |
| `POSTGRES_DB=aven_test corepack pnpm exec tsx scripts/connections-maintenance-verify.ts` | 37/37 通过 |
| `corepack pnpm connections:verify:retention` | 开发库 37/37 通过，命令实际执行 |
| `corepack pnpm connections:maintain` | 实际执行成功；本次返回 0/0/0，无需重复清理 |
| `CONNECTION_MAINTENANCE_BATCH_SIZE=0 corepack pnpm exec tsx scripts/connections-maintenance.ts` | 预期失败，退出码 1，不访问清理函数 |
| `corepack pnpm exec tsx scripts/connections-verify.ts` | 74/74 HTTP/数据库检查通过，含自然到期后延长不复活 |
| `corepack pnpm exec tsx scripts/m5-journey-verify.ts` | 21/21 组织引荐与关系回归通过 |
| `corepack pnpm exec tsx scripts/m6-journey-verify.ts` | 37/37 忙闲/授权/活动回归通过 |
| `corepack pnpm build` | 12/12 任务通过；Expo JS 导出不代表原生构建 |
| `corepack pnpm test` | 22 个文件、188/188 通过 |
| `corepack pnpm typecheck` | 20/20 任务通过 |
| `corepack pnpm lint` | ESLint 与依赖边界通过，123 模块、369 依赖 |
| `corepack pnpm check:readiness` | API/Worker、迁移门 0033 与 Redis 故障路径通过 |
| `corepack pnpm format:check` / `git diff --check` | 通过 |

检查覆盖清理窗前后、固定批次、Worker/普通池/伪造 GUC、外用途保护、部分来源、只清理一次的并发、锁跳过、系统事件脱敏、正文不可替换/恢复、接收决定失败、发送幂等重放和连接元数据保留。首轮夹具曾遇 SQL 参数类型推断冲突，已显式使用 UUID 类型，后续隔离/开发库均重新通过；未把该失败当作成功。

## 命令与运行边界

```bash
corepack pnpm connections:verify:retention
corepack pnpm connections:maintain
CONNECTION_MAINTENANCE_BATCH_SIZE=100 corepack pnpm connections:maintain
```

每次只执行一批；各阶段分别最多 batchSize 项。有积压时由后续生产编排重复调用并监控计数/失败，不能把当前命令称为自动调度。校验脚本会创建带开发名称的账号/数据并模拟历史时间，禁止在生产运行。`db:verify` 会重建 aven_test，不能与使用该库的验证同时运行。

## 未完成与下一步

- 未交付自动调度、积压指标/告警、跨用途快照清理、授权/连接事件保留、用户数据删除申请和备份恢复演练；不能据此关闭 M7 或接纳真实私人数据试点。
- 回填只在当前开发数据规模验证，大规模存量生产部署须另行评估分批与锁时长。
- 没有 UI 修改，未重复工程诊断页 E2E；原型/历史 E2E 不代表产品小组件验收。没有依赖修改或 Expo/原生复验，既有 SDK 兼容与设备缺口未关闭。
- 开发计划中 M0-08、M4-03、M5-04、M5-06、M6-02 校正为 PARTIAL，M5-09 为 REVIEW，保留历史证据。完整缺口与依赖见 [系统现状](SYSTEM_STATUS.md)。
- 下一项可独立开发 **M6-06A 站内通知**，随后推进个人连接会话/消息；产品 UI 则先满足 M1-07 正式双端评审门，再接入登录、对话壳与连接小组件。
