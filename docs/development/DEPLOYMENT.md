# 本机域名部署

日期：2026-11-13。用户明确授权部署至 `https://aven.topodrive.top`。

## 当前运行

- Nginx 独立虚拟主机：`infra/nginx/aven.topodrive.top.conf`；已安装至 `/etc/nginx/sites-available/aven.topodrive.top` 并启用。其他站点未修改。
- `aven-web`、`aven-api`、`aven-worker` 三个 systemd 服务已启用开机自启，模板见 `infra/systemd/`；分别监听回环 3000、3001、3002。运行路径为本仓库，部署的是 Next production build 与编译后的 API/Worker。
- `/etc/aven/runtime.env` 以 root 0600 保存运行配置，由 systemd 注入；没有提交密钥。PostgreSQL/Redis 使用已有 Compose 卷与 `unless-stopped`，未重建、未执行迁移。
- APP_ENV 为明确的 development 验证环境，默认 Mock，邮件写入本机受限文件，不向公众展示验证码。页面明确显示开发验证版；此部署不是正式生产身份或真实数据试点。
- API origin 限定为该 HTTPS 域名。Nginx 强制 Secure/SameSite Cookie，关闭 API 缓存/缓冲和上游自动重试；拒绝公网 `/health/`，关闭访问日志以免记录敏感查询。

## TLS 与 CDN

公网已通过 CDN 提供有效 HTTPS，首页及 API 可达。域名解析至现有 EdgeOne CDN，不修改 DNS。源站独立证书的 HTTP-01 请求三次被 CDN 返回 567，CA 验证失败；手动读取同一挑战 URL 可成功。未继续重复请求，以免触发 CA 限流。

源站目前临时引用本机既有 `topodrive.top` 证书，独立 `aven.topodrive.top` 源站证书尚待完成。仓库模板使用最终独立证书路径，**在证书就绪前不要直接覆盖本机配置**。需要 CDN 管理端排查 ACME 校验路径或 DNS-01 授权后再签发；公网 CDN 证书正常不代表源站独立证书已通过。

## 已执行验证

- `nginx -t` 通过；现有其他站点的协议配置警告保持原状。
- 三个 systemd 服务 active、enabled；首页 HTTPS 200 且包含 AVEN；未登录 `/api/v1/auth/me` 返回 401，响应禁止缓存。
- 使用合成账号在公网执行最终账号/历史/行动复验 15 项全部通过：Web Cookie 登录、独立移动 Bearer、资料更新、Web 撤销移动会话立即失效、Mock Worker/SSE 历史重读、元数据不含正文、非法游标拒绝、390px 无横溢、密码恢复非枚举响应、无未捕获浏览器错误。
- 整段账号脚本复跑时，重复使用同一合成账号触发登录频控 429，该复跑未通过。随后复用仍有效的两份合成会话完成安全/行动/跨账号历史隔离专项 18 项：预览/确认、默认拒绝、跨账号行动拒绝、拉黑/解除/举报、各自历史包含本人 run、交叉 run/SSE 404。未清除频控记录或调整阈值。

## 更新与排障

先完成仓库检查和 `pnpm build`，再 `sudo systemctl restart aven-web aven-api aven-worker`。只更改代理时先 `sudo nginx -t`，通过后 `sudo systemctl reload nginx`。检查服务使用 `systemctl is-active`；运行日志由 journald 管理，不输出环境变量或邮件正文。

目前 API 在反向代理后未信任外部转发地址，IP 频控会合并至回环地址；账号级频控仍独立生效。扩大多人测试前应实现受限代理来源与 CDN 真实客户端 IP 验证，不能直接信任任意 X-Forwarded-For。


2026-11-13 认证界面视觉增量：按用户截图调整为深色纯色、白色正圆角色、胶囊表单和更清晰留白。Web production build 已重新部署，API/Worker 无改动；公网浏览器实际完成注册、登录、工作区和退出及密码恢复请求。视觉与视口证据见根目录 design-qa.md。
