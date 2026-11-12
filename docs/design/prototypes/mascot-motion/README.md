# AVEN 圆形角色动效

日期：2026-11-12 · 状态：设计动效稿，未接入产品页面或真实 Agent 状态。

[打开可交互动效](index.html)。保持用户确认的方向：没有手脚，黑色正圆和两只白色胶囊眼睛。以 SVG 的单个 `circle` 作为外轮廓；只允许整体平移、旋转和等比缩放，禁止压扁、拉长、剪切或附加肢体。呼吸与惊喜里的缩放也是等比缩放。

| 动效 | 独立 SVG | 表现 |
|---|---|---|
| 轻轻呼吸 | [aven-idle.svg](aven-idle.svg) | 轻浮动、微弱等比呼吸与偶尔眨眼 |
| 眨眨眼 | [aven-blink.svg](aven-blink.svg) | 连续眨两下，伴随轻微点头 |
| 好奇看看 | [aven-curious.svg](aven-curious.svg) | 歪头、左右看，双眼轻微不对称 |
| 开心蹦蹦 | [aven-happy.svg](aven-happy.svg) | 眯眼与两次轻跳 |
| 认真思考 | [aven-thinking.svg](aven-thinking.svg) | 眼神向一侧上移，缓慢歪头 |
| 惊喜一下 | [aven-surprise.svg](aven-surprise.svg) | 眼睛睁大、轻跳与等比放大 |
| 困困了 | [aven-sleepy.svg](aven-sleepy.svg) | 双眼眯成短胶囊，缓慢摇晃 |
| 打个招呼 | [aven-hello.svg](aven-hello.svg) | 整体左右摇头和眨眼，不增加手 |

另附 [静态正圆 SVG](aven-static.svg)。几何参考为上一轮圆形 PNG，使用矢量重建确保外轮廓为标准圆，不依赖 PNG 不完全相同的横纵像素边界。

## 交互

- 点击表情或用方向键/Home/End 切换；点击角色或对其按空格，切换为开心。
- 鼠标靠近时眼睛小幅跟随；关闭“眼神跟随”或移开鼠标时回中。
- 可暂停/播放；自动换表情默认关闭，启用后每 5 秒切换。
- 遵循系统 `prefers-reduced-motion`：保留选中表情，关闭眨眼、位移、缩放及跟随，禁用轮播。
- 页面隐藏时停止轮播并暂停 CSS 动画，恢复可见后继续；没有网络请求或第三方依赖。

## 复用

独立 SVG 内含 CSS 动画，不包含 JavaScript，可通过支持 SVG/CSS 动画的浏览器或 `img` 使用。静态 SVG 可用于不支持动画的宿主。原生应用需要按相同运动参数实现适用的原生动画，不把浏览器验证算作原生验收。

动态眼神跟随、表情切换和播放控制在 `index.html` 中；这部分是纯设计交互，没有自动映射真实 AI 运行状态。接入产品时，应由真实状态事件决定何时进入等待、思考或成功等表现，不能用角色动作充当执行进度。

## 实际验证

```bash
PLAYWRIGHT_CHANNEL=chrome node scripts/mascot-motion-verify.mjs
node node_modules/eslint/bin/eslint.js scripts/mascot-motion-verify.mjs --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check --ignore-path /dev/null package.json scripts/mascot-motion-verify.mjs docs/design/prototypes/mascot-motion/index.html
node node_modules/prettier/bin/prettier.cjs --check --ignore-path /dev/null --parser html docs/design/prototypes/mascot-motion/*.svg
git diff --check
```

检查器实际通过 69 项校验，并额外执行选择、点击和键盘断言：8 种状态均有真实运行的动画；每种状态在 5 个动画时刻读取屏幕变换矩阵，确认圆形保持等比、无剪切；动画时钟推进、暂停冻结、眼神跟随、轮播暂停/恢复、系统减少动态与全部独立 SVG 均已检查。320/390/728px 与 200% 文字无横向溢出。无运行时或控制台错误。截图输出到系统临时目录，并打印路径。

视觉复查打开了默认、开心与困倦截图，修正了胶囊眼睛在“旋转后再非等比压缩”时产生的斜切感；开心表情改用两道圆头笑弧，其他表情仍以胶囊眼睛形变表达。角色主体始终只进行等比缩放。未执行真机、完整屏幕阅读器或产品业务 E2E；未改变 M1-07 REVIEW 状态。
