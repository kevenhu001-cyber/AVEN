# P2P-01 个人连接邀请交付记录

日期：2026-11-12 · 范围：后端个人连接底座；产品界面、AI 推荐、消息与通知未交付。

## 实际交付

- 新增个人邀请预览、确认发送、双方列表/详情、受控快照、接收方决定、撤回、授权撤销和个人连接列表 API。
- 发送代表发起方同意；接收方使用独立会话接受或拒绝。接受时原子创建无序用户对唯一连接，支持并发/重复接受。
- 仅发送用户选择的、已确认且允许 sharing 的记忆正文；不附带姓名、标题、邮箱、未选记忆或对话。
- 预览锁定实际值、来源/策略版本、接收方和绝对期限，10 分钟内有效。变化后重新预览，发送不延长期限。
- 独立用途 `connection_invitation`，不升级为关系用途。新连接不复制授权正文，不套用组织/机会关系表。
- 撤销、拒绝与撤回阻断后续快照读取。来源删除/失效/收紧 sharing 同事务将条目标为 stale；恢复用途不复活旧授权。部分来源失效时可读快照只剩当前有效项，但接受旧邀请必须拒绝。

## 文件与架构

| 路径 | 变化 |
|---|---|
| `packages/contracts/src/index.ts` | 个人连接请求/响应 Zod 契约，actor 不由客户端传入 |
| `packages/contracts/src/connections.test.ts` | 输入限制、用途期限、重复选择、actor/快照注入与版本检查 |
| `packages/database/migrations/0030_connection_purpose.sql` | 新增用途枚举，先独立提交供后续迁移使用 |
| `0031_personal_connections.sql` | 四张表、约束/索引/FORCE RLS、最小权限、受控函数、来源失效触发器 |
| `0032_connection_complete_consent.sql` | 接受时要求所有原选来源仍有效，修正仅检查至少一项的不足 |
| `packages/database/src/schema.ts` / `verify.ts` | Drizzle 映射、32 个迁移与 52 张租户表（49 张 public + 3 张 app）FORCE RLS 检查 |
| `packages/database/src/index.ts` | 就绪迁移门提升至 0032，缺失个人连接迁移时不能报就绪 |
| `apps/api/src/connection/*` / `app.module.ts` | 真实会话、CSRF、输入/输出校验、事务与受控函数适配，无私人正文日志 |
| `scripts/connections-verify.ts` / `package.json` | 四开发账号 HTTP/数据库验收，新增 `connections:verify` |
| `docs/api/CONNECTIONS.md` / ADR-011 / TDD / SCHEMA | 契约与边界，保持组织引荐不变 |

迁移 0030–0032 已在本地开发库应用；隔离库验证空库、旧库升级、seed/迁移幂等。没有编辑已经应用的旧迁移。0032 是后续检查发现部分授权失效边界后新增的修正迁移。

## 已执行验证

| 命令 | 结果 |
|---|---|
| `corepack pnpm db:verify` | 184 项通过；32 个迁移、52 张租户表 FORCE RLS；空库/升级/seed/迁移幂等 |
| `POSTGRES_DB=aven_test corepack pnpm exec tsx scripts/connections-verify.ts` | 53 项通过，四个独立开发账号 |
| `corepack pnpm db:migrate` | 本地开发库应用 0030–0032 |
| `corepack pnpm exec tsx scripts/connections-verify.ts` | 开发库 53 项通过 |
| `corepack pnpm connections:verify` | 新命令实际执行通过；12 项构建任务与 53 项检查通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪、依赖与 Redis 故障路径通过；迁移门为 0032 |
| `corepack pnpm exec tsx scripts/m5-journey-verify.ts` | 21/21 组织引荐闭环回归通过 |
| `corepack pnpm exec tsx scripts/m6-journey-verify.ts` | 37/37 忙闲/授权/活动回归通过 |
| `corepack pnpm build` | 12/12 任务通过，包含 Expo Android JS 导出；不代表原生构建 |
| `corepack pnpm test` | 20 个文件、167/167 测试通过 |
| `corepack pnpm typecheck` | 20/20 任务通过（含依赖构建） |
| `corepack pnpm lint` | ESLint 与依赖边界通过，122 个模块、365 条依赖 |
| `corepack pnpm format:check` | 通过 |
| `PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e` | 6/6 工程诊断页通过；不是个人连接 UI 验收 |
| `corepack pnpm check:expo` | 失败：9 个依赖仍低于 SDK 58 推荐补丁版本；本轮未改依赖 |

执行初期发现拆出的契约 `.js` 路径不能由 Expo 的源码入口解析，已改用现有契约入口方式并重新完整构建。测试 harness 曾与重建隔离数据库同时运行，产生环境失败；已改为顺序执行，并在重建完成后重新通过 53 项，未把失败计为通过。

## 权限、并发与失败证据

53 项包括：无会话与 CSRF；自邀请/无效接收方/越权来源；预览不送达；同幂等键重试、异参冲突、预览一次消费；双向并发发送；双方独立决定；并发接受唯一连接与单条接受事件；撤回与接受竞争；外人 404/RLS 过滤；直接预览正文不可读；到期预览；源版本变化；普通编辑不改变旧快照；收紧 sharing、部分来源失效、恢复用途不复活、软删除；撤销即时阻断与旧发送幂等结果不带私密正文。

## 未实现与后续

- 接收方通过登录后的列表读取收到邀请，不是通知推送、SSE 实时投递或真机跨终端验收。
- 无个人发现/语义推荐、小组件接入、真实 AI、用户 Provider 对话、共同消息或插件运行时。
- 无拉黑/举报、连接关闭/删除、邀请速率限制与完整数据保留清理任务；预览和授权正文的保留清理尚待实现。本轮仅开发数据，不可据此接纳真实用户试点。
- 当前端点按已知用户 UUID 指定接收人；没有新增任意用户检索或私人资料发现能力。列表最多 100 条，分页待补。
- 只共享选择的记忆正文；显示名/资料字段选择需后续独立映射，不能把原型字段直接当作本轮接口。
- 已建立的个人连接不是原组织关系空间，旧关系/活动 API 尚不支持个人连接。接入共同会话前须明确成员和消息契约。
- M1-07 正式双端评审仍待完成；本轮没有更改设计门或编写产品 UI。

下一轮可推进个人连接小组件的契约适配与真实登录/会话壳；UI 编码仍须满足正式设计门。共同聊天、通知、发现与试点保障分别交付。
