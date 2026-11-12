# M6-06A1 个人连接站内通知交付

日期：2026-11-12。只关闭个人连接通知后端范围，M6-06/M6-06A 保持 PARTIAL。开发数据验证，无产品通知 UI、活动通知、移动推送或真实设备验收。

## 实际交付与行为

- 个人邀请 sent/accepted/declined/withdrawn/revoked 事件在业务事务内追加 Outbox 和投递记录；失败回滚不会发送通知，没有历史补发。
- 独立 `aven-notification` 队列和数据库事务回执。队列只携带 eventId/generation；消费重新读取数据库来源与接收方，当前业务/来源/双方状态和偏好失效时 suppressed。
- 通知只含固定 kind 与邀请 ID，不复制姓名、邮箱、记忆、对话或授权快照。列表/直接 RLS/已读均按当前接收人和业务状态检查，过期待办或已处理邀请不继续返回。详情须走原连接 API。
- 默认邀请/更新通知均开启；偏好更新使用乐观版本。关闭只抑制尚未送达的对应分类，恢复不重放 suppressed 通知。已读保存首次时间，支持稳定游标与当前可见未读数。
- 队列单作业最多 5 次指数退避；失败保存固定错误码，dead 不自动重排。平台管理员按 generation 重排并审计；并发只有一个新代数，旧任务/失败回调不能污染新代数。
- processed 只代表入队；pending 对账补投丢失任务。重复投递、入队后崩溃、并发消费由数据库唯一键和事务去重。
- 收件箱 90 天后不可见并支持显式分批清除；保留投递回执，旧事件重放不复活已清除通知。

## 文件、架构、数据库与 API

| 文件 | 变化 |
|---|---|
| `packages/database/migrations/0034_connection_notifications.sql` | 四张 FORCE RLS 表、约束/索引、同事务触发器、最小权限、消费/偏好/读取/死信/清理函数 |
| `packages/database/src/{schema,index,verify}.ts` | Drizzle 映射、就绪迁移门 0034、34 个迁移/56 张租户表（53 public + 3 app）检查 |
| `packages/contracts/src/index.ts` / `notifications.test.ts` | 严格通知/分页/偏好/重排与仅元数据 DTO |
| `packages/domain/src/notification.ts` / `.test.ts` | 与 Nest/React 无关的作业边界、可信函数调用和失败记录 |
| `apps/api/src/notification/*` / `app.module.ts` | 实际会话/CSRF、读取/已读/偏好、当前平台管理员死信 API、统一 409 |
| `apps/worker/src/notification.ts` / `runtime.ts` / `outbox.ts` | 独立消费者、5 次重试、pending 对账、失败记录收尾、就绪与优雅停机 |
| `packages/api-client/src/notifications.ts` / `.test.ts` / `connections.ts` / `index.ts` | 类型化通知方法，复用逐次 Cookie/CSRF 或 Bearer，严格输入/响应，无缓存/自动写重试 |
| `scripts/notifications-verify.ts` / `notifications-maintenance.ts` | 真实 HTTP/数据库/队列验证、仅计数维护输出 |
| `scripts/async-verify.ts` | 工程样例清理收紧为自身事件/消费者，加入其他 Outbox 记录保护断言与生产环境拒绝 |
| `package.json` / `.env.example` / CI | 验证/维护命令与批次变量，CI 加入实际通知验证命令；GitHub Actions 未实跑 |
| API/SCHEMA/TDD、ADR-013、README/AGENTS/开发计划 | 明确元数据通知模式、用途边界、当前阶段与后续范围 |

新增 0034，未修改已经应用的迁移。开发库已应用；隔离库空库、旧库升级、保留清理旧数据升级夹具、seed/迁移幂等均通过。未使用全 schema DML、可写 Worker GUC 或运行角色提权。

新增 `/api/v1/notifications`：GET 列表/偏好/管理员死信，POST 已读/偏好/管理员重试。详见 [API 契约](../api/NOTIFICATIONS.md) 与 [ADR-013](../architecture/decisions/0013-in-app-connection-notifications.md)。此前未实施的通知 title/body/data 方案收紧为固定 kind/target，理由是避免通知成为授权正文的长期副本。

## 实际验证

| 命令 | 结果 |
|---|---|
| `corepack pnpm db:verify` | 184 项原有数据库检查与旧数据升级断言通过；34 个迁移、56 张租户表 FORCE RLS |
| `corepack pnpm db:migrate` | 本地开发库应用 0034 |
| `POSTGRES_DB=aven_test corepack pnpm exec tsx scripts/notifications-verify.ts` | 62/62 HTTP/数据库/真实 Redis-BullMQ 检查通过 |
| `corepack pnpm notifications:verify` | 12/12 构建任务、开发库 62/62 检查通过 |
| `corepack pnpm notifications:maintain` | 实际执行通过；本次 0 条待清理，保留窗固定 90 天 |
| `NOTIFICATION_MAINTENANCE_BATCH_SIZE=0 corepack pnpm exec tsx scripts/notifications-maintenance.ts` | 预期退出码 1；未执行清理 |
| `corepack pnpm test` | 25 个文件、202/202 通过（新增 14 项通知边界单测） |
| `corepack pnpm typecheck` | 20/20 任务通过 |
| `corepack pnpm lint` | ESLint 与依赖边界通过，129 个模块、394 条依赖 |
| `corepack pnpm exec tsx scripts/connections-verify.ts` | 74/74 个人连接回归通过 |
| `corepack pnpm exec tsx scripts/connections-maintenance-verify.ts` | 37/37 保留清理回归通过 |
| `corepack pnpm exec tsx scripts/m5-journey-verify.ts` | 21/21 组织引荐/关系回归通过 |
| `corepack pnpm exec tsx scripts/m6-journey-verify.ts` | 37/37 忙闲/授权/活动回归通过 |
| `corepack pnpm check:readiness` | API/Worker、迁移门 0034、通知消费者与 Redis 故障路径通过 |
| `corepack pnpm async:verify` | 30/30 共享 Outbox/租约/重试/Redis 故障与样例清理隔离检查通过 |
| `corepack pnpm format:check` / `git diff --check` | 通过 |

62 项检查覆盖：四个独立账号、实际 Cookie/CSRF 与移动 Bearer、越权与伪造身份、同事务回滚、元数据无正文、所有五种事件、重复/并发消费与已读、偏好并发、当前过期/来源/主体状态、五次真实作业失败、死信权限/代数/审计、丢任务对账、入队后崩溃、游标、90 天清理不复活。没有把 Mock 输出、原型或截图作为这些检查的证据。

初次验证发现测试脚本从根目录无法解析 Worker 私有 Redis 依赖，已由 Worker 通知运行时统一创建/释放自己的 Redis 连接。测试夹具还曾尝试反向邀请一个仍 pending 的用户对，服务端正确返回冲突；已在夹具中显式结束旧邀请后重跑。后续隔离与开发库均通过，未把失败记录计为成功。

共享异步回归最初因旧样例脚本尝试删除全部 Outbox 而被通知外键拒绝。已将清理限制为 sample_task.created 和样例消费者，并增加非样例事件保留断言；未削弱业务外键或清空通知数据。

## 运行与限制

提交前补验（2026-11-12）：修正工程诊断页中“通知尚未实现”的旧文案，明确未实现的是活动通知与移动推送；重新构建 Web 后 Chrome E2E 6/6、lint 与格式检查通过。第一次页面检查使用旧构建而失败，重建后重新通过。原型内嵌字体的官方 OFL 许可也已补齐。`check:expo` 仍因 9 个推荐补丁不匹配失败，尝试 `CI=1 pnpm --filter @aven/mobile exec expo install --fix` 被 `minimumReleaseAge: 720` 拒绝；没有改等待策略、依赖清单或 lockfile，尚不能作为可发布版本。

首次纳入暂存区后，`git diff --cached --check` 提示 0031/0032 有尾随空格及文件末尾空行。两份迁移已经应用，为遵守不可改写迁移和校验和规则原样提交；未通过修改迁移或放宽检查来隐藏提示。

```bash
corepack pnpm notifications:verify
corepack pnpm notifications:maintain
NOTIFICATION_MAINTENANCE_BATCH_SIZE=100 corepack pnpm notifications:maintain
```

正常 `dev:worker` 启动通知派发与消费者；API 写入时不直接触碰 Redis，队列失败不回滚邀请业务。维护命令只执行一批；生产定时编排与告警仍未配置。数据库回执承诺的是原子站内副作用与至少一次投递下去重，不承诺外部服务 exactly-once。

- 活动提案/确认/取消通知、移动推送、推送凭据、通知 UI、实时 SSE/WebSocket 通知均未交付。当前用户仍需界面/客户端主动请求通知列表，不能称为跨终端推送。
- 只有本迁移后的 connection_events 会触发通知；保留历史数据不代表向用户补发历史消息。通知失败不会扩大共享授权，单条通知与详情分别鉴权。
- 显式个人连接端点的撤销/撤回会产生对应通知；通用 ConsentGrant 撤销会立即使旧邀请通知不可见，但未单独补发撤销通知。
- 消费回执、Outbox、源事件和运维审计的完整保留/对账告警与容量规划仍待 M7；死信 API 已有权限/审计，但没有管理 UI。并发更新后的已送达元数据或系统外副本不承诺收回。
- 没有依赖升级、产品页面修改或设备验收；没有重复工程诊断页 E2E。既有 Expo 推荐补丁/真机/发布构建缺口未关闭。
- 开发与隔离验证共用本机 Redis 队列名，须顺序运行且避免另一个环境的通知 Worker 同时消费；生产环境需独立 Redis/命名空间。验证脚本的故障夹具只针对本次开发事件，退出时清除触发器并撤销临时管理员角色；不得在生产或真实数据环境运行。
- 下一轮可推进 M6-06A2 活动站内通知，再推进个人连接会话/消息契约；产品 UI 仍需满足 M1-07 正式双端评审门。
