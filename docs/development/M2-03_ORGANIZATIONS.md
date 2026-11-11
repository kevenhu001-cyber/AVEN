# M2-03 组织成员与邀请

日期：2026-11-11 · 状态：组织创建、成员列表、邀请/接受、角色变更、移除/离开与最后 owner 保护已实现并通过真实 HTTP/数据库验证；所有权转让、审核与 FORCE RLS 未实现

## 范围

本轮实现组织身份与成员关系的最小闭环：创建组织（创建者为 owner）、列出本人组织、组织详情与成员、owner/admin 邀请、被邀请人接受、owner 变更 admin/member 角色、owner/admin 移除成员、成员离开、最后 owner 保护。未实现所有权转让、组织认证审核、审计日志、`FORCE RLS`、Web/Mobile 页面。

## 交付

| 路径 | 内容 |
|---|---|
| `packages/database/migrations/0009_organizations.sql` | 10 个组织函数、函数所有权、RLS 策略与授权 |
| `packages/contracts/src/index.ts` | 创建组织、组织摘要/详情、成员、邀请、接受、角色变更 Schema |
| `apps/api/src/organization/*` | OrganizationModule/Controller/Service；事务本地用户上下文；邮件邀请 |
| `scripts/organization-verify.ts` | 31 项真实 HTTP/数据库检查 |
| `docs/api/ORGANIZATIONS.md` | 端点契约与安全边界 |

## 实际验证记录

2026-11-11 在本机执行：

| 命令 | 结果 |
|---|---|
| `corepack pnpm organization:verify` | 31/31 通过；创建/列表/详情、非成员隔离、owner/admin/member、邀请/接受、重复邀请、邮箱不匹配、无效 token、角色变更、移除、离开、最后 owner 保护、重复 slug、CSRF |
| `corepack pnpm test` | 62/62 通过（新增组织 contracts 测试） |
| `corepack pnpm db:verify` | 9 个迁移、10 个组织函数所有权、无上下文拒绝、成员列表、admin 不能改 owner、最后 owner 不能离开、创建者成为 owner |
| `corepack pnpm typecheck` / `build` | 18/18 与 11/11 Turbo tasks 通过 |
| `corepack pnpm check:readiness` | API/Worker 就绪检查仍通过 |

关键安全断言：

- 组织函数只使用事务本地 `app.user_id`，不信任客户端 actor/role。
- 非成员不能读取组织详情/成员；admin 不能改 owner 或移除 owner；最后 owner 不能离开。
- 邀请 token 只存 SHA-256；邮箱不匹配/无效 token 不泄露邀请存在性。
- 重复邀请刷新 pending token；重复接受返回同一 membership。
- 创建组织自动创建唯一 owner membership；组织认证状态保持 `unverified`。

## 已知限制

- 未实现所有权转让；最后 owner 只能保持 owner，不能离开。
- 未实现组织认证审核、校园管理员、审计日志、邀请撤销/过期清理任务。
- 未实现 `FORCE RLS`、跨组织隔离集成测试（M2-04/M2-05）。
- 未实现 Web/Mobile 组织控制台页面；当前只有 API 与验证脚本。
- 生产邮件 Provider 未选择；开发使用 `.data/mail` sink。
- 未验证真实设备、并发邀请/接受、管理员移除竞争与生产数据保留。

## 下一步

- M2-04：授权基础设施、写策略与 `FORCE RLS`。
- M2-05：至少两个个人、两个组织、不同角色的隔离集成测试。
- 所有权转让、组织认证与审计在后续组织管理任务补齐。
