# M6 求交可靠性交付记录

日期：2026-11-11 · 范围：既有求交修复补验与领域输入防护，不关闭 M6 整体验收。

## 核对结果与范围

仓库已有认证、组织、授权、确定性匹配、关系空间、忙闲和活动后端。M1-07 正式双端设计评审尚未完成，个人页面和组件层继续受阶段门限制。M6-05 AI 协调、M6-06 通知投递、真实日历连接、向量语义召回与 Android 主线仍未实现。

开始本轮时工作区已有未提交的求交契约/UTC 修复、诊断页文案与 E2E 改动。本轮保留这些改动，增加领域防护与 HTTP 回归，没有提交或推送。

## 实现与架构

- `packages/domain/src/time-intersection.ts`：无效日期、非正整数时长/步长、反向或零长度忙闲区间返回空候选；启用工作时段时校验 UTC 整点范围 `0 <= start < end <= 24`。避免忽略错误忙闲数据后错误产生空闲候选，保持框架无关。
- `packages/domain/src/time-intersection.test.ts`：新增 17 项非法输入测试，原有正常求交与跨日 UTC 测试保留。
- `scripts/m6-journey-verify.ts`：用 UTC 构造测试日期，新增 7 项真实 HTTP 检查：空/反向/超 31 天时间窗、超 50 个主体、超 31 天时长、默认 UTC 工作时段排除忙闲与非工作时段、31 天合法上限。
- `docs/api/AVAILABILITY_EVENTS.md`：补充领域失败语义；README、开发计划和 M6 记录同步实际结果。

没有数据库结构、迁移、权限模型或新增 API 端点。仍通过既有主库函数逐主体检查用途授权；撤销后投影与求交继续整体拒绝。测试使用本地开发数据，不连接真实 Provider、日历或推送服务。

## 实际命令与结果

| 命令 | 结果 |
|---|---|
| `corepack pnpm format:check` | 通过 |
| `corepack pnpm lint` | 通过，依赖边界无违规 |
| `corepack pnpm typecheck` | 20/20 任务通过（含依赖构建任务） |
| `corepack pnpm test` | 19 个文件、162/162 测试通过 |
| `corepack pnpm m6:verify` | 构建 12/12 任务通过（10 项缓存命中），37/37 真实 HTTP/数据库检查通过 |
| `TZ=Asia/Shanghai corepack pnpm exec vitest run packages/domain/src/time-intersection.test.ts packages/contracts/src/time-intersection.test.ts` | 28/28 通过 |
| `PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e` | 6/6 通过，仅工程诊断页的桌面与移动网页验证 |
| `corepack pnpm check:expo` | 失败，9 个已安装包低于 SDK 58 推荐补丁版本 |

本轮未运行空库/升级迁移验证、GitHub Actions、原生真机或发布构建；Expo Android JS 导出不能替代原生验收。

## Expo 阻塞

依据 [Expo CLI 官方依赖检查说明](https://docs.expo.dev/more/expo-cli/)，先运行 `expo install --check`。随后尝试以下精确补丁安装：

```bash
corepack pnpm --filter @aven/mobile add --save-exact @expo/ui@58.0.28 expo@58.0.24 expo-constants@58.0.16 expo-font@58.0.12 expo-linking@58.0.17 expo-router@58.0.31 expo-splash-screen@58.0.14 expo-status-bar@58.0.5 expo-symbols@58.0.5
```

安装返回 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`：推荐补丁及部分传递依赖仍在 `minimumReleaseAge: 720` 的 12 小时等待期内。未降低等待期、添加豁免或关闭 Expo 校验；`apps/mobile/package.json` 与 `pnpm-lock.yaml` 均未改动。

## 后续任务与限制

- 依赖成熟后重新查询 SDK 推荐版本，按 ADR-001 单独升级并提交 PR，重新执行冻结安装、兼容检查、类型与构建。
- 求交工作时段固定为 UTC 09:00–18:00，未实现参与者各自的当地工作时段与夏令时转换；本轮不声明当地工作时段或真实设备验收通过。
- M1-07 正式双端设计评审通过后再进入产品 UI；M6-06 通知仍需契约、受控写入、Outbox、幂等、偏好、重试与死信处理。
