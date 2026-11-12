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
