# WEB-05：基础交互、插件参数与过渡修复

日期：2026-11-13。范围沿用 ADR-017/018，仅完善个人 Web，不增加真实 Provider、OAuth、远程 MCP 或原生端能力。

## 当前完成情况

个人 Web 已有注册/登录、Mock SSE、手工记忆与候选复核、个人连接邀请/消息、站内通知与偏好。插件目录包含 11 个内置连接器，支持 Mock 调用和 12 类声明式结果卡片；模拟授权只在本页有效。屏幕栈、Sheet、菜单与角色已有 CSS 动效。以上不代表完整 MVP、第三方账号连接或正式双端设计验收完成。

## 本轮修改

- 动作表单以插件 ID 和动作名作为组件身份，切换动作重新初始化默认值、错误和输入，防止沿用另一动作参数。会话中的动作 Sheet 同步处理。
- 前端增加整数、有限数、上下界、枚举、字符串长度、数组数量校验，显示中文字段名并阻止无效调用；服务端完整 Schema 校验仍为最终边界。
- 表单卸载后忽略异步结果与错误，避免离开表单后突然回到对话或写入过期结果；不自动重试写请求。
- 动作表单使用现有 CSS 入场过渡，遵循减少动态设置。菜单重新打开时清除旧关闭计时器，避免快速操作时意外消失。
- 新增参数边界单测与菜单快速开关的 Playwright 回归。导航入口未变，`scripts/lib/personal-web-nav.mjs` 已核对，无需改动步骤。

无新增依赖、数据库迁移或 API 变更。未修改本地已有的 `apps/mobile/android/` 未跟踪目录。

## 验证

- `pnpm lint`：通过，209 个模块、663 条依赖无边界违规。
- `pnpm typecheck`：20 个任务通过。
- `pnpm exec vitest run`：47 个文件、334 项通过。
- `pnpm exec turbo run build --filter='!@aven/mobile' --concurrency=1`：11 个任务通过。
- 初次检查受旧生成物影响：Next.js 类型指向已不存在的 settings 页面，数据库 dist 引用了不存在的 agent-history 模块。移出旧 `.next` 缓存并强制重建共享包后上述检查通过；没有为旧生成物修改源码依赖。
- 标准 E2E 启动被本地已有 3001 服务占用阻塞；个人状态夹具使用临时配置仅启动 3100 Web。默认 Chromium headless shell 缺失，改用本机 Chrome；`PLAYWRIGHT_CHANNEL=chrome pnpm exec playwright test --config playwright.personal-check.config.ts`：桌面与手机尺寸共 8 项通过。临时配置复用 `playwright.config.ts`，仅保留 Web server 并设置 `testMatch: personal-state.spec.ts`；验证后删除临时配置。此结果仅为个人状态夹具回归，非完整 E2E 或真实业务集成。

未执行数据库集成脚本、真实外部服务、原生构建或正式设计验收。本次仅补齐上述明确缺陷；真实连接器凭据持久化与远程传输、历史会话、生产通知调度和完整产品验收仍待后续工作。
