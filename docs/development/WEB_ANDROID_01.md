# WEB/ANDROID-01 双端个人工作区

日期：2026-11-13。依据 ADR-018 实施；本轮为个人工作区增量，完整 MVP 与原生发布尚未验收。

## 文件与架构

- Web：`apps/web/src/features/personal/` 新增资料/密码/设备会话、找回密码、个人运行历史、记忆行动预览确认、拉黑与举报；复用现有 Cookie/CSRF、组件与业务 API。
- Android：`apps/mobile/src/` 新增原生工作区、账号认证、Mock SSE/历史恢复、记忆/复核、个人邀请/消息、通知/偏好、连接器/12 种卡片、安全与行动确认；Expo Router 首页接入，原工程页移至 `/diagnostics`。没有 WebView。
- 共享：`packages/api-client` 补齐账号、移动认证、行动确认与插件表单纯函数；移动 Bearer 请求不带 Cookie，不自动重试写入。未知邀请/消息/确认保留原请求标识；草稿创建未知时停止重复创建。
- API/数据库：`GET /api/v1/agent/runs` 返回本人个人运行元数据，以时间/ID 键集分页；Repository 在既有受限角色与事务身份下执行，显式过滤当前用户与个人会话。无新增表、迁移或已应用迁移修改。输入/输出正文不出现在历史列表；SSE 重读仍受实时来源授权和 24 小时保留窗约束。
- 会话：Android 使用按 API origin 绑定的 SecureStore；后台立即卸载私人视图并中止读取，前台重新鉴权后显示。401 清除令牌，网络失败保留凭据但隐藏私人界面；generation 与 AbortController 拒绝旧响应恢复会话。没有私人正文持久化缓存。
- 依赖：按 Expo SDK 58 兼容矩阵更新精确补丁；`minimumReleaseAge: 720` 保留，仅对本轮指定版本列出例外，未整体关闭等待期。新增 SecureStore、Crypto、系统主题与原生会话单测依赖。

## Android APK

用户指定通过 GitHub Actions 生成 APK，不在本机进行原生编译。工作流为 `.github/workflows/android-apk.yml`，支持 push、PR 与手动触发：

1. 锁定 Node/pnpm、安装 JDK 与 Android 工具，检查共享包、移动类型与测试。
2. Expo CNG prebuild 后执行 Gradle `:app:assembleRelease`，包含 JS 包，不依赖 Metro；包含 arm64-v8a 与 x86_64。
3. 上传 `aven-android-apk-<run_number>`，包含 APK、SHA256SUMS、提交与构建编号，保留 14 天；失败则上传原生构建报告。

在仓库 Settings → Secrets and variables → Actions → Variables 设置 `EXPO_PUBLIC_API_URL`，或手动运行时填写 `api_url`。只允许手机可访问的 HTTPS origin，不含路径、凭据或查询参数。它是打包进应用的公开地址，不能填密钥。未配置时应用显示配置引导，不能进行业务验收。服务端仍须显式 Mock 与独立部署。

产物使用 Expo 模板生成的开发签名，仅供内部安装，未接入商店签名。重新生成签名可能要求卸载旧包后安装，会清除设备数据。下载 Actions 对应 run 的 Artifacts ZIP，核对 SHA-256 后安装；构建成功不代表设备主线已通过。

实际远端结果：首轮 [43288072976](https://github.com/kevenhu001-cyber/AVEN/actions/runs/43288072976) 在单测步骤失败：全局 production 模式导致 React 测试 act 不可用。已将测试步骤明确设为 NODE_ENV=test；本机同组 90 项通过，修复提交后重新构建。APK 成功仍待结果，不把本机 JS 导出记为 APK 构建。

## 验证记录

- 本轮最新类型检查：20 个任务通过；lint 与依赖边界检查通过。
- 全量单测：48 个文件、328 项通过；随后新增的行动确认传输 3 项独立通过（token/版本/幂等键、未知结果不重试、路径/CSRF 拒绝）。
- Android 会话单测 5 项包含在 328 项中：origin 绑定、后台卸载/前台复核、旧响应不复活、401 清理、网络失败不误删凭据。使用 mock 原生模块，不代替 Android Keystore 真机检查。另修复流已结束但迟到的取消失败把界面恢复为 running，以及离开页面后迟到的取消 401 错误影响新会话的问题；新增 2 项并发回归，移动专项共 7 项通过。
- 本轮前段已执行 Web 连接器 8 项、候选复核 12 项、个人主线 18 项、恢复 7 项；新增账号/历史界面本地与公网各 13 项通过；复用仍有效的合成会话，在公网另完成行动/安全/跨账号历史隔离 18 项，包括草稿确认、默认拒绝用途、跨账号行动 404、拉黑/解除/举报、本人历史与跨账号 run/SSE 404。
- `check:expo` 本轮更新依赖后在线检查通过。
- 最新整包构建 12 个任务与格式检查通过；锁定依赖安装通过。Web 账号专项本地与公网各 13 项通过；公网部署细节与源站证书限制见 [DEPLOYMENT](DEPLOYMENT.md)。整段账号脚本复跑曾触发 429；后续复用有效合成会话完成 18 项安全/行动专项，没有清除频控或提高阈值。GitHub Actions 结果单独记录。

## 剩余与限制

- 待 APK 安装后的原生登录/SecureStore、SSE、弱网结果未知、前后台/进程终止、多账号撤销、键盘/深链与无障碍验收。没有连接设备或模拟器运行证据。
- 正式双端设计评审、完整页面状态矩阵与原生发布签名仍待完成。M1-07 保持 REVIEW，M5-08 为 PARTIAL。
- 站内通知使用主动读取，没有移动即时推送或生产后台调度。连接器与 Agent 默认 Mock，没有真实 Provider、真实 MCP、第三方账号或外部日历 OAuth 验收。
- 组织/机会/引荐/关系/活动完整产品双端旅程、语义向量召回、生产身份运营和 M7 试点仍未全部交付；不能把本轮个人工作区称为完整应用开发完毕。
- 本轮数据库仍维持 38 个已应用迁移，0039 未应用；没有执行空库/升级回归。
