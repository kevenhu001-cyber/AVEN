# ADR-005：异步执行与 Outbox

- 状态：提议（M0-07 验证）
- 日期：2026-11-10
- 相关：[TDD](../TDD.md) · [SCHEMA](../../database/SCHEMA.md)

## 背景

API 和 Worker 需要共享业务规则。直接让 Worker 复制 API Service 会产生两套逻辑；让 Worker 直接写数据库会绕过权限和事务边界。业务写入与队列投递之间还存在双写不一致风险。

## 决策

1. 使用 **Transactional Outbox**：业务写入和 `outbox_events` 在同一事务提交。
2. 派发器用 `FOR UPDATE SKIP LOCKED` 取事件，投递到 BullMQ，成功后标记 processed；失败按指数退避，超过上限进入 dead。
3. BullMQ `jobId` 使用 Outbox 事件 ID，消费端按业务键去重。
4. 创建 `packages/domain` 存放框架无关的领域服务；API 和 Worker 都组合它，不复制业务规则。
5. Worker 是 NestJS standalone 应用，不启动 HTTP 业务路由；每个作业恢复 actor 上下文并复核权限/授权。
6. 处理器必须幂等；外部副作用使用 Provider 幂等键或去重表。
7. 普通 CRUD 不异步化；只有记忆 embedding、匹配重算、授权失效、通知、日历同步、活动提醒等进入队列。
8. 失败区分可重试与不可重试；死信保留脱敏 payload，人工重放需要审计。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Worker 直接 import API Service | 代码复用快 | 构建耦合、边界模糊 | 不采用 |
| Worker 通过内部 HTTP 调 API | 边界清晰 | 网络/鉴权/超时复杂，事务难共享 | 不作为首版 |
| 无 Outbox，直接 enqueue | 简单 | 双写不一致，丢任务 | 不采用 |
| Outbox + 共享 domain | 一致、可重试、边界清晰 | 新增包和派发器 | 采用 |

## 后果

- 新增 `packages/domain` 和 Outbox 派发器；M0-07 需要验证其可行性。
- 队列是至少一次投递，业务必须幂等。
- 需要监控 Outbox 延迟、队列积压、死信和重试。
- 领域服务不能依赖 Nest 装饰器；API/Worker 通过依赖注入组合。
- 事务内不做外部调用；AI、邮件、推送都异步。

## 验证

- [ ] 一个真实任务完成入队、执行、失败、重试、幂等和死信。
- [ ] 业务写入回滚时 Outbox 事件不产生。
- [ ] 重复投递不产生重复副作用。
- [ ] Worker 重启后能继续处理未完成事件。
- [ ] 授权撤销后，异步任务不再产生外部可见内容。
- [ ] 记录派发器锁、重试参数和监控指标。
