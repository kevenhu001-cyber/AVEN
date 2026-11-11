# 架构决策记录（ADR）

本目录记录影响 AVEN 架构、数据、安全和交付方式的决策。每个 ADR 包含背景、决策、备选方案、后果和验证。

| ADR | 决策 | 状态 |
|---|---|---|
| [ADR-001](0001-runtime-and-toolchain.md) | Node 24 LTS、pnpm、Turborepo 与框架版本锁定 | 已接受，M0-02/03 验证 |
| [ADR-002](0002-identity-and-sessions.md) | 自建邮箱 + 密码、不透明会话、校园认证分离 | 已接受，M2 实现 |
| [ADR-003](0003-data-runtime.md) | Docker Compose 数据运行 | 扩展/验证时机部分被 ADR-008 取代 |
| [ADR-004](0004-data-authorization.md) | RLS + 事务本地上下文基线 | 被 ADR-007 取代，保留历史 |
| [ADR-005](0005-async-and-outbox.md) | Transactional Outbox + BullMQ + 共享领域服务 | 已接受，M0-07 样例验证；业务可靠性未实现 |
| [ADR-006](0006-ai-provider.md) | Mock 默认 + OpenAI-compatible Provider 抽象 | 已接受，M3 验证 |
| [ADR-007](0007-authorization-boundaries.md) | 字段用途、独立引荐、最小权限与撤销语义 | 已接受，未实现；取代 ADR-004 |
| [ADR-008](0008-progressive-delivery.md) | 按需扩展、双端设计与真实数据准入 | 已接受，未验证；部分取代 ADR-003 |
| [ADR-009](0009-authentication-implementation.md) | Argon2id、不透明会话、CSRF、限流与认证函数边界 | 已接受，M2-01 实现验证；补充 ADR-002 |
| [ADR-010](0010-availability-authorization.md) | 忙闲用途授权共享、默认拒绝与撤销即时生效 | 已接受，M6-01R 实现验证；补充 ADR-007 |

新增 ADR 时：

1. 使用下一个编号和 `kebab-case` 文件名。
2. 写明状态（提议/已接受/已废弃/被取代）。
3. 记录背景、决策、备选方案、后果和验证方式。
4. 更新本索引和 [TDD 第 18 节](../TDD.md#18-adr-索引)。
5. 不修改已接受 ADR 的历史结论；用新 ADR 取代并注明。
