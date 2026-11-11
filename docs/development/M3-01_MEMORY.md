# M3-01 已确认个人上下文

日期：2026-11-11 · 状态：手工确认记忆的创建、读取、更新、软删除、来源与字段策略已实现并通过真实 HTTP/数据库验证；候选提取、生命周期清理、组织记忆与共享未实现

## 范围

本轮实现个人手工确认上下文：兴趣、技能、项目、目标、偏好等记忆条目；每条包含私人正文、结构化值、敏感度、有效期、来源与字段策略（展示受众、发现开关、self_ai/matching/sharing 用途）。所有写操作通过受控函数，所有者校验与 RLS 同时生效。未实现 M3-02 候选提取/确认、M3-03 生命周期清理、M3-04 Provider、M3-05 流式、组织记忆或共享授权。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0011_memory.sql` | 7 个枚举、3 张表、3 个所有权触发器、FORCE RLS、6 个记忆函数与授权 |
| `packages/contracts/src/index.ts` | 记忆枚举、创建/更新、item/policy/source/detail/list Schema |
| `apps/api/src/memory/*` | MemoryModule/Controller/Service；游标分页；版本合并；CSRF 由 AuthGuard 统一校验 |
| `scripts/memory-verify.ts` | 27 项真实 HTTP/数据库检查 |
| `docs/api/MEMORIES.md` | 端点契约与安全边界 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm memory:verify` | 27/27 通过；创建/详情/列表/分页、来源、策略、更新/版本冲突、软删除、跨用户拒绝、CSRF、非法输入 |
| `corepack pnpm test` | 64/64 通过（新增记忆 contracts 测试） |
| `corepack pnpm db:verify` | 74 项通过；11 个迁移、6 个记忆函数所有权、21 张表强制 RLS、记忆创建/更新/删除/跨用户隔离 |
| `corepack pnpm typecheck` / `build` | 18/18 与 11/11 Turbo tasks 通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查仍通过 |

关键安全断言：

- 记忆 owner 必须等于事务本地 `app.user_id`，且 principal 类型为 user/organization；不能为他人创建记忆。
- 来源与字段策略触发器校验 memory item 所有权；不能伪造 owner/source。
- 普通池只能读本人记忆；直接 INSERT 被拒绝；跨用户读取/更新/删除返回 404。
- 删除是软删除；列表/详情立即拒绝，策略用途清空并关闭发现。
- 字段策略默认拒绝；`owner` 受众不能 discoverable；`campus` 受众必须有 active 校园。
- 更新使用 `expectedVersion` 乐观锁；旧版本返回 409。

## 已知限制

- 未实现候选提取、pending_confirmation 确认/拒绝、记忆生命周期清理与索引失效。
- 未实现组织记忆、组织成员读取、匹配画像、向量/语义检索或共享授权。
- 未实现 Web/Mobile 记忆页面；当前只有 API 与验证脚本。
- 未实现真实 AI Provider、来源对话/文件/导入、记忆评估集或真实设备。
- 未验证大数据量游标性能、并发更新、备份恢复与生产数据保留。

## 下一步

- M3-02：记忆候选提取、确认/修改/拒绝；只有确认且允许使用的信息进入相应检索范围。
- M3-03：编辑、失效、删除、索引清理与授权影响。
- M3-04/M3-05：Provider/工具契约与 POST run + SSE 流式。
- 组织记忆与共享授权在 M4/M5 接入。
