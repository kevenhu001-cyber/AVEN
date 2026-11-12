# WEB-LOGIN-02 欢迎入口、闪烁修复与 SMTP

日期：2026-11-13。用户要求检查持续闪烁，参照新 Grok Bot 截图重做登录 UI，并参考 Socrates 的邮件实现。APK 保持暂停。

## 变化

- 欢迎页采用深色纯色画布、外围静态彩色 AVEN 角色、居中的品牌与一句介绍、底部单个“登录或注册”。角色是既有正圆 SVG 的颜色变体，无循环动画、阴影或渐变。
- 认证按需打开；桌面居中面板、手机底部面板，登录/注册/密码恢复共用。密码显隐、输入校验、自动填充和键盘焦点保留。
- 会话生命周期从 PersonalApp 提取到 usePersonalSession。旧版 focus/pageshow 会设置 checking 并卸载匿名表单，实测标题出现“正在验证会话 → 欢迎回来”。新版匿名复核保持表单挂载、合并在途请求；登录后强制使用新 Cookie 复核，忽略旧 401；退出后旧读取不能恢复身份。私人视图仍在隐藏、离线、跨标签会话变化时遮挡，过期清空。
- 参考 `/home/ubuntu/User/Socrates/server/src/services/core/email.ts` 的 Nodemailer/SMTP 方案，使用 AVEN 独立 Mailer 与环境配置；没有修改 Socrates 项目。连接与认证、TLS 校验、STARTTLS、超时和禁止正文/协议日志有检查。生产不回退到开发文件。
- 重置邮件包含 `WEB_ORIGIN/#reset_token=...` 链接及可手动填写的重置码；fragment 不发给源站，客户端提取后立即清除。已登录用户也能打开恢复面板；重置成功后本页清除身份。令牌一小时、一次性，服务端撤销全部旧会话。

## 文件、接口与部署

主要文件为 `apps/web/src/features/personal/{auth-welcome,auth-form,auth-shell,personal-app,use-personal-session,password-recovery,auth-reset-link}`、`personal.css`、`apps/web/public/mascot/welcome-*.svg`、共享 Dialog 的 overlayClassName、API auth Mailer/Service、config 邮件环境解析及 lockfile。

无新数据库迁移、表或 HTTP 端点。Web 验证脚本增加欢迎页入口步骤，`auth-verify` 的开发邮件解析兼容新重置码文案。新增 `pnpm password-recovery:verify`：启动随机端口的隔离 API 实例，显式 file sink 与独立 IP 哈希盐，不清除线上限流键，不向外部发信。

本机 `aven-web`、`aven-api` 已重新构建并重启，域名仍为 https://aven.topodrive.top。`/etc/aven/runtime.env` 已配置现有 SMTP 通道与 AVEN 发信身份，权限 0600，原环境保留受限备份；没有提交或输出真实 SMTP 值。开发命令继续从 `.env` 使用文件邮件，部署服务从 systemd 环境读取 SMTP。Worker 与数据库未重启或改动。

## 实际检查

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 20 个任务通过；随后 Web 构建再次包含 TS 校验 |
| `pnpm lint` | 通过，233 个模块 / 755 个依赖无边界违规；后续 UI/脚本定向 lint 通过 |
| `pnpm test` | 53 个文件、348 项通过，新增会话 5、fragment 5、SMTP 5 项 |
| `pnpm --filter @aven/api build`、`pnpm --filter @aven/web build` | 通过；没有 Android 原生编译 |
| 锁定安装 | `pnpm install --frozen-lockfile` 通过 |
| `tsx scripts/password-recovery-verify.ts` | 11 项真实 HTTP/数据库检查通过：创建/登录、非枚举请求、fragment 邮件、一次性消费、旧会话/旧密码拒绝、新密码登录 |
| 实际 SMTP | Socrates 原配置及部署后的 AVEN 配置分别通过 TLS/账号认证，未发送测试邮件 |
| 浏览器 | T3 preview 检查 390×844、320×568、1440×900；欢迎/面板切换、真实合成账号登录/退出、已登录恢复链接、URL 清理、焦点复核与输入保留通过 |
| 闪烁 | 连续 5 次 focus + 5 次 pageshow 后，输入框/面板节点相同、邮箱/密码保持、标题切换 0 次 |
| 控制台 | 新生产页仅出现预期匿名 auth/me 401，无未捕获应用异常或框架错误层 |

旧脚本针对新增欢迎入口已调整，本轮没有重新跑全部历史 Web 脚本。SMTP 站点的浏览器检查复用已有合成账号；不要向真实 SMTP 新增 `@example.test` 收件人测试，完整恢复验证使用隔离 file 模式。

## 验收边界

当前是 Mock 开发验证站点。SMTP 连接和认证通过不等于收件箱已实际送达；真实邮箱收信、SPF/DKIM 投递质量、原生软键盘与屏幕阅读器仍需实测。认证 UI 检查不关闭 M1-07 正式双端设计评审，也不代表 M7 或完整生产身份系统完成。源站独立证书和历史游标精度等既有待办保留。
