# Socrates UI 来源与适配记录

用户明确要求复用本机 `/home/ubuntu/User/Socrates` 的成熟 UI。本轮只读该项目，未修改它。

## 参考实现

- `frontend/src/styles/themes.css`：当前黑灰表面层级、主次字色与主题语义。
- `frontend/src/styles/foundations/fonts.css` / `fonts-cjk.css`：Geist Sans 与 Noto Sans SC，中文标点从中文字体回退。
- `frontend/src/styles/parity/sidebar.css` / `topbar.css` / `composer-unified.css`：260px 侧栏、52px 顶栏、输入区与插件 Chip。
- `packages/ui/src/composer/ComposerFrame.tsx`：输入与工具栏的两层组织方式。
- `frontend/src/react/composer/ComposerPluginItems.tsx`：已选能力、工具菜单与插件目录模式。
- `frontend/src/styles/components/tool-card.css`：自然正文、轻量工具状态，以及需要用户决定时才出现的卡片。

## 实际查看的产品截图

- `frontend/e2e/test-results/visual-qa/topic-dark.png`
- `frontend/e2e/test-results/visual-qa/composer-workflow-selected-desktop.png`
- `frontend/e2e/test-results/visual-qa/composer-workflows-menu-mobile.png`

仓库根部的 `screenshot_*` 是营销页旧截图，本轮未将它们误作聊天界面基准。

## 字体与图标

原型内嵌用户项目现有的 `frontend/src/assets/fonts/geist-sans-variable.woff2`，以及 `site/media/fonts` 中覆盖本稿中文的 13 个 Noto Sans SC 字体分片。保持字体家族名称，不依赖 CDN；没有重新生成字体轮廓或替换为手工图形。分片用于设计评审，任意后续新增文字仍需检查字体覆盖。

2026-11-12 提交前补齐字体分发许可：[GEIST_OFL.txt](GEIST_OFL.txt) 来自 [Geist 官方仓库](https://github.com/vercel/geist-font/blob/main/OFL.txt)，[NOTO_SANS_SC_OFL.txt](NOTO_SANS_SC_OFL.txt) 来自 [Google Fonts Noto Sans SC](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt)。正式产品仍应通过统一资产管线维护字体与许可。

图标使用 Lucide Static 0.468.0 的官方 SVG 源码，保留 `LUCIDE_LICENSE`，不使用手绘图标或截图中的个人头像。

没有搬入 Socrates 的账号、模型配置、运行时、插件服务或业务代码。AVEN 的圆角和无光影要求优先于 Socrates 中原有阴影规则；主导航按用户本轮产品方向收敛。
