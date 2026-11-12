# 欢迎入口与闪烁修复 QA

日期：2026-11-13。本次以新 Grok Bot 图片为视觉依据，完成 AVEN 欢迎页与按需认证面板。正式 M1-07 双端设计评审仍为 REVIEW。

## 源图与实现

- 源图：`/home/ubuntu/.t3/userdata/attachments/114d3d20-b9f4-44e7-ae5d-ae48f9448e52-5445c5c4-c2ac-47db-9b0c-14fccdd84a4e.jpg`，899×2000px，含系统状态栏；按 390px 宽度归一，约 868px 高，顶部系统栏约 35 CSS px 不属于网页。
- 手机欢迎页：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdzwqj4-a147e98a.png`，780×1688px，390×844 CSS，DPR 2。
- 同图归一比较：`/tmp/aven-welcome-compare.png`，已同时打开并比较源图与实现。
- 手机登录面板：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdzwqse-125ed6a1.png`。
- 桌面欢迎页：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdzxlhy-1156c8d4.png`；桌面面板 `browser-screenshot-aven-topodrive-top-mwdzwr79-bf43c4e4.png`，1440×900 CSS / 2880×1800px。
- 短屏：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdzxl6a-2b7c3a82.png`，320×568 CSS / 640×1136px。

## 发现、修正与复查

1. [P1 已修复] 旧版焦点/页面恢复会切换到“正在验证会话”并卸载登录表单，造成闪烁和输入丢失。复现标题序列为“正在验证会话 → 欢迎回来”。新版连续触发 5 次 focus 和 5 次 pageshow 后，输入与面板节点保持，邮箱和密码保持，标题变化为 0。
2. [P1 已修复] 旧版首屏直接铺满表单，与本轮图片的欢迎入口不符。现为静态彩色角色、品牌文案和单一底部动作，点击再打开认证面板。
3. [P0 已修复] 初次手机面板沿用桌面的个体 translate，出现 x=-195px。已改用响应式 Tailwind translate 归零；最终 390px 宽面板 x=0，320px 宽面板 x=0、宽320、高522，未溢出或遮挡主操作。
4. [P2 已修复] 首轮文案偏高；下移欢迎文案并核对源图系统栏差异。面板移除重复大角色，以轻量 AVEN 标识、标题和表单聚焦认证。

## 核对结果

| 项目 | 结果与证据 |
|---|---|
| 页面身份 | 线上 https://aven.topodrive.top，AVEN 标题，欢迎内容完整，无框架报错覆盖层 |
| 字体 | 本地 Geist / Noto Sans SC，欢迎标题 44–64px、说明 15–17px、表单输入 16px；真实中文文案正常换行 |
| 配色与资产 | #131313 画布，复用正圆 AVEN SVG 的静态颜色变体；角色无拉伸、无新循环动画。保留 AVEN 正圆规范，未照搬第三方角色轮廓 |
| 留白与布局 | 手机底部单动作，桌面居中面板，手机底部面板；320/390/1440px 无横溢；控件高54px，短屏面板能容纳核心操作 |
| 光影与焦点 | 控件无 box-shadow/渐变，焦点使用实线描边；背景角色静止，不参与用户操作或焦点顺序 |
| 交互 | 打开/关闭、焦点陷阱、密码显隐、登录/退出、恢复链接进入与 fragment 清除通过 |
| 会话 | 匿名复核保留输入和节点；已登录隐藏/前台重验、旧响应拒绝由5项回归覆盖；真实合成账号登录和已登录恢复链接已在线验证 |
| 邮件 | SMTP TLS/认证通过；11项真实 HTTP/数据库检查验证 fragment 链接、一次性消费及旧会话撤销，使用隔离 file sink，没有外部测试邮件 |
| 控制台 | 新生产页仅预期匿名 auth/me 401，无未捕获应用 JS 异常；本机 dev 停止产生的旧 HMR 断线记录不属于生产页错误 |

完整同图比较和面板边界/焦点局部检查均已完成，无未解决 P0/P1/P2。参考形状按 AVEN 正圆规范适配；底部真实 Mock 标识占用额外一行，安全区与按钮位置据此调整。短屏部分装饰角色互相接近，未遮挡内容，作为 P3 后续可精简。真实软键盘、屏幕阅读器和收件箱实际送达仍待独立实测。

final result: passed

## 上一轮记录（历史范围）

# Web 认证界面视觉 QA

日期：2026-11-13。范围：用户三张手机参考图所指定的比例、配色和控件特征，适配 AVEN 登录、注册、密码恢复与会话检查。正式 M1-07 双端设计评审仍为 REVIEW。上一版 v0.4 原型自检详见 [历史详细记录](docs/design/prototypes/m1-07-v3/design-qa.md)。

## 视觉依据与比较

- 原始参考：`/home/ubuntu/.t3/userdata/attachments/114d3d20-b9f4-44e7-ae5d-ae48f9448e52-df1cf8ce-871e-4719-9df1-69ed02c1b0a9.jpg`、`/home/ubuntu/.t3/userdata/attachments/114d3d20-b9f4-44e7-ae5d-ae48f9448e52-0d80cdc7-298d-4d80-8d4d-e607f3f60553.jpg`、`/home/ubuntu/.t3/userdata/attachments/114d3d20-b9f4-44e7-ae5d-ae48f9448e52-9979d9bf-3936-4c65-abc8-04b6fec4d311.jpg`。
- 后两张均 899 × 2000px；按宽度归一为 390px，对应约 868px 高。参考图含设备状态栏，应用不复刻设备或第三方品牌。
- 390 × 844 CSS 视口截屏为 780 × 1688px（DPR 2）；归一为 390 × 844px。完整同图比较：`/tmp/aven-auth-reference-comparison.png`，参考、角色参考、线上注册同排。
- 手机注册：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdy8jqd-5b6bae81.png`。
- 桌面注册：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdyc3fu-51012124.png`，1440 × 900 CSS / 2880 × 1800px。
- 短屏注册：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdyc3jy-b419edcf.png`，320 × 568 CSS / 640 × 1136px。
- 最终恢复状态：`/home/ubuntu/.t3/userdata/browser-artifacts/browser-screenshot-aven-topodrive-top-mwdyfitg-36ba0793.png`。

## 发现与修复历史

1. [P1，已修复] 原深色页面的黑色角色叠在白色圆形底板上，形成白圈；占用 160px，挤压表单。改为复用真实 AVEN SVG，透明底板、反色与等比旋转，认证主圆实际约 88px。归一比较中，参考主圆约 86px，应用约 88px。
2. [P1，已修复] 原表单、切换、忘记密码、开发说明与诊断挤成同一组；没有参考图的留白层级。改为品牌页首、角色标题、表单、账号切换与页脚；移出工程入口，简短 Mock 标识保留。
3. [P2，已修复] 密码恢复返回提示与首个输入框紧贴。第一轮截图 `browser-screenshot-aven-topodrive-top-mwdyde1h-934868c2.png` 可见。增加直接提示块的 16px 下间距，精简重复说明；最终 `mwdyfitg-36ba0793.png` 已回验。

## 核对结果

| 项目 | 实际证据与结果 |
|---|---|
| 字体与层级 | 复用本地 Geist / Noto Sans SC；标题 28px，输入 16px，说明 14px；无第三方字体请求；标题/提示正常换行 |
| 留白与比例 | 手机左右 24px，表单最大 360px；主圆约 88px；表单输入与主按钮 54px；短屏自然纵向滚动，无横向溢出 |
| 配色与效果 | 画布 rgb(19,19,19)，中性灰控件、白色角色与主动作；实测控件 boxShadow/backgroundImage 均 none，键盘焦点为 solid outline |
| 资产 | 现有 AVEN SVG 正圆、两只胶囊眼睛；没有重绘为第三方品牌、复制徽章或状态栏；轮廓无拉伸 |
| 页面身份 | 线上 `https://aven.topodrive.top`，标题 AVEN；页面非空，无框架报错覆盖层 |
| 交互 | 登录/注册切换；密码显示和隐藏；Tab 从邮箱到密码、可见切换、提交；真实注册 201 → 登录 200 → 工作区 → 退出；恢复请求 202 → 重置表单 |
| 控制台 | 没有未捕获应用 JS 异常；未登录 auth/me 的 401 为预期。开发阶段 React DevTools/HMR 提示来自本机 dev；生产页无开发工具入口 |
| 主题 | 系统 light/dark 下认证页均遵循用户指定深色方向；未改写组织和工程页面主题 |

参考图用于视觉规则，注册表单按 AVEN 认证契约实现。参考界面的聊天空白、搜索栏、人物徽章没有对应到注册动作，不作为注册页面待补功能。保留 AVEN 名称与角色自身眼睛位置。

已完成局部焦点、角色和输入尺寸检查；完整同图比较足以确认本轮平面颜色与比例，没有需要进一步放大定位的 P0/P1/P2 差异。后续真机软键盘、屏幕阅读器与 200% 字体缩放不在本轮浏览器检查的完成声明内。

final result: passed
