# AVEN 设计系统

版本：1.0 · 日期：2026-11-10 · 状态：M0-01 基线
需求来源：[原始产品与工程规格](../../Origin%20Plan.md) 第 1–4 节
产品契约：[PRD](../product/PRD.md)

本文把原规格的视觉方向提取为可实现的令牌、布局、组件和验收规则。所有页面必须遵循本文；未定义的组件先在本文补充，再进入实现。

## 1. 定位与原则

关键词：Minimal、Refined、Quiet、Intelligent、Editorial、Spatial、Functional。

设计目标不是做一个更漂亮的校园社交软件，而是让用户清楚知道：

- AI 正在做什么。
- 为什么推荐这件事。
- 需要自己确认什么。
- 当前执行到了哪一步。
- 最终产生了什么结果。

### 1.1 必须遵守

- 中性色为主，大量留白，细边框，清晰字体层级，轻量动效。
- 强调色只用于重要状态、选中项和关键操作。
- 用背景、边框和排版建立层级，优先不用阴影。
- 每个页面覆盖加载、空、错误、成功、禁用和无权限状态。
- 所有核心交互必须真实可用；未实现的功能明确说明。
- Web 与原生共享令牌和语义，不强行共享所有组件。

### 1.2 禁止

- 大量渐变背景、玻璃拟态、大面积彩色卡片。
- 每个功能一个独立彩色图标。
- 用 Emoji 代替图标。
- 把所有内容放进带边框的容器。
- 传统 SaaS Dashboard 式的指标卡片堆砌。
- 把 AI 对话做成客服聊天窗口。
- 让工具执行信息占据整个屏幕。
- 用静态成功数据伪装业务功能。
- 没有解释的匹配分数或“AI 认为你们很合适”。

## 2. 设计令牌

令牌是唯一颜色、字号、间距、圆角和动效来源。组件中不允许大量硬编码值。

### 2.1 颜色

#### Light Theme

| Token | 色值 | 用途 |
|---|---|---|
| `background` | `#FFFFFF` | 页面背景 |
| `background-secondary` | `#F7F7F6` | 次级页面背景 |
| `surface` | `#FFFFFF` | 内容表面 |
| `surface-secondary` | `#F5F5F4` | 次级表面 |
| `foreground` | `#191919` | 主文字 |
| `foreground-secondary` | `#6B6B6B` | 次级文字 |
| `foreground-tertiary` | `#999999` | 辅助文字 |
| `border` | `#E8E8E6` | 普通边框 |
| `border-strong` | `#D6D6D3` | 强调边框 |
| `primary` | `#202020` | 主按钮 |
| `primary-foreground` | `#FFFFFF` | 主按钮文字 |
| `accent` | `#526B5F` | 品牌强调 |
| `accent-foreground` | `#FFFFFF` | 强调色上的文字 |
| `destructive` | `#B94B4B` | 危险操作 |
| `destructive-foreground` | `#FFFFFF` | 危险操作文字 |
| `success` | `#2F6B4F` | 成功状态（补充令牌） |
| `warning` | `#8A5A1F` | 警告状态（补充令牌） |
| `info` | `#3D5A73` | 信息状态（补充令牌） |
| `focus-ring` | `#526B5F` | 键盘焦点环 |
| `overlay` | `rgba(17, 18, 20, 0.32)` | Dialog/Popover 遮罩 |
| `skeleton` | `#F0F0EE` | 骨架屏 |

#### Dark Theme

| Token | 色值 | 用途 |
|---|---|---|
| `background` | `#111214` | 页面背景 |
| `background-secondary` | `#17191C` | 次级背景 |
| `surface` | `#191B1E` | 内容表面 |
| `surface-secondary` | `#202226` | 次级表面 |
| `foreground` | `#F3F3F1` | 主文字 |
| `foreground-secondary` | `#A0A2A6` | 次级文字 |
| `foreground-tertiary` | `#777A80` | 辅助文字 |
| `border` | `#2B2E33` | 边框 |
| `border-strong` | `#3A3E44` | 强调边框（补充令牌） |
| `primary` | `#F2F2F0` | 主按钮 |
| `primary-foreground` | `#171717` | 主按钮文字 |
| `accent` | `#89A795` | 品牌强调 |
| `accent-foreground` | `#111214` | 强调色上的文字（补充令牌） |
| `destructive` | `#D97A7A` | 危险操作（补充令牌） |
| `destructive-foreground` | `#1A1111` | 危险操作文字（补充令牌） |
| `success` | `#8FBF9F` | 成功状态（补充令牌） |
| `warning` | `#D8B06A` | 警告状态（补充令牌） |
| `info` | `#9DB6C9` | 信息状态（补充令牌） |
| `focus-ring` | `#89A795` | 键盘焦点环（补充令牌） |
| `overlay` | `rgba(0, 0, 0, 0.56)` | Dialog/Popover 遮罩（补充令牌） |
| `skeleton` | `#23262A` | 骨架屏（补充令牌） |

补充令牌来自原规格未覆盖的状态需求；M1-01 必须用实际对比度工具验证并记录。正文对比度目标至少 4.5:1，大号文字至少 3:1。

#### 使用规则

- 强调色只用于：选中项、关键操作、品牌标识、少量状态提示。
- 危险色只用于删除、撤销、拒绝等不可逆或高风险操作。
- 成功/警告/信息色只用于状态，不用于装饰。
- 不允许在组件中直接写十六进制颜色；必须引用令牌。
- 深色模式不是简单反色；表面层级和边框对比需单独验证。

### 2.2 字体

| 用途 | 字体栈 |
|---|---|
| 英文/界面 | `Inter, Geist, ui-sans-serif, system-ui, sans-serif` |
| 中文 | `"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif` |
| 等宽 | `"Geist Mono", ui-monospace, SFMono-Regular, monospace` |

字体大小与行高：

| Token | 大小 | 行高 | 字重 | 用途 |
|---|---:|---:|---:|---|
| `display` | 36px | 1.2 | 600 | 特殊欢迎标题 |
| `h1` | 28px | 1.25 | 600 | 页面主标题 |
| `h2` | 22px | 1.3 | 600 | 页面分区标题 |
| `h3` | 18px | 1.35 | 500 | 卡片/区块标题 |
| `body` | 15px | 1.65 | 400 | 正文 |
| `body-sm` | 14px | 1.6 | 400 | 辅助正文 |
| `caption` | 12px | 1.5 | 400 | 元数据 |
| `micro` | 11px | 1.4 | 400 | 极少量辅助信息 |

规则：

- 正文行高 1.65；标题行高 1.25–1.35。
- 不要所有文字都加粗；强调优先用字重 500，标题才用 600。
- 中文正文不小于 14px；移动端正文不小于 15px。
- 数字、时间、代码使用等宽字体。
- 长文本最大宽度约 68–76 个字符；AI 对话正文最大 760px。

### 2.3 间距

基础单位 4px。核心间距：

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64`

| 场景 | 建议 |
|---|---|
| 图标与文字 | 8px |
| 表单字段之间 | 16px |
| 卡片内边距 | 16–20px |
| 区块之间 | 24–32px |
| 页面主区块之间 | 40–48px |
| 桌面页面左右留白 | 32–40px |
| 移动页面左右留白 | 16–20px |

主要内容区必须有充足留白；不要为了展示更多信息把页面挤满。

### 2.4 圆角

| Token | 半径 | 用途 |
|---|---:|---|
| `radius-sm` | 6px | 小型元素、标签 |
| `radius-md` | 10px | 按钮、输入框 |
| `radius-lg` | 14px | 卡片 |
| `radius-xl` | 18px | 大型内容容器 |
| `radius-full` | 999px | 头像、胶囊标签 |

避免所有组件都使用特别大的圆角；同一页面圆角层级不超过三种。

### 2.5 阴影

默认不使用阴影。优先用背景色和 1px 边框区分层级。

只在 Popover、Dialog 和浮动菜单使用轻微阴影：

| 场景 | Light | Dark |
|---|---|---|
| Popover | `0 8px 24px rgba(17,18,20,0.08)` | `0 8px 24px rgba(0,0,0,0.40)` |
| Dialog | `0 16px 48px rgba(17,18,20,0.12)` | `0 16px 48px rgba(0,0,0,0.56)` |

### 2.6 动效

| 动作 | 时长 |
|---|---:|
| Hover | 120ms |
| Button Feedback | 120ms |
| Popover | 150ms |
| Modal | 180ms |
| Sidebar | 200ms |
| Page Transition | 200ms |
| Large Panel | 240ms |

- 缓动默认 `cubic-bezier(0.2, 0, 0, 1)`。
- 动效应自然、克制；不要让整个界面不断运动。
- AI 生成内容平滑流式显示；工具执行使用简洁状态变化，不用复杂加载动画。
- 必须支持 `prefers-reduced-motion`；减少动态时保留状态变化但去掉位移和缩放。

### 2.7 图标

使用 Lucide Icons，不混用其他图标库。

| 尺寸 | 用途 |
|---|---|
| 16px | 小型辅助、行内 |
| 20px | 常规 |
| 24px | 重点操作、空状态 |

- 线性图标，视觉线宽 1.5px 或 1.75px。
- 图标颜色继承文字色，不单独上色。
- 菜单项前不放不同颜色的图标。
- 不使用 Emoji 代替图标。

### 2.8 断点与栅格

| 断点 | 范围 | 布局 |
|---|---|---|
| `mobile` | < 640px | 单列，底部导航，页面内 Stack |
| `tablet` | 640–1023px | 单列或双列，侧栏收起 |
| `desktop` | 1024–1279px | 侧栏 + 主区，按需上下文面板 |
| `wide` | ≥ 1280px | 侧栏 + 主区 + 可选上下文面板 |

- 桌面主内容最大宽度 760–900px。
- AI 对话正文最大 760px，居中。
- 上下文面板建议 320–360px，仅在需要时出现。
- 移动端不保留固定侧栏。

## 3. 布局

### 3.1 桌面端

三层结构：

1. Navigation Sidebar。
2. Main Workspace。
3. Optional Context Panel。

Sidebar：

- 展开 248px，收起 64px。
- 顶部：AVEN Logo、New Action。
- 主导航：Today、Network、Life、Spaces。
- 中部：最近对话、最近组织、最近关系空间。
- 底部：My AI、Settings、Profile。
- 必须支持收起；收起后保留图标和可访问名称。

Main Workspace：

- 普通页面最大宽度 760–900px。
- 内容按页面需要调整，不强行居中所有内容。
- 页面标题、说明、主操作形成清晰层级。

Context Panel：

- 仅在需要时出现：机会对应组织、人物共同背景、活动参与者和约束、项目成员和目标。
- 不能所有页面强制三栏。
- 关闭后主区自然扩展，不留下空白占位。

### 3.2 移动端

- 原生优先，不做 Sidebar 缩小版。
- 底部五个入口：Today / Network / Life / Spaces / My AI。
- 主要页面使用原生 Stack Navigation，支持返回手势。
- 聊天输入框必须处理软键盘、Safe Area 和输入焦点。
- 长内容滚动时保持主要操作可达；避免固定元素遮挡内容。
- 触控目标至少 44×44px。

### 3.3 AI 对话页

- 正文最大 760px，居中。
- 输入框固定在底部区域，页面滚动时保持可用。
- 消息类型至少支持：文本、机会卡、人物卡、组织卡、项目卡、活动卡、行动预览、工具活动、来源引用、确认对话框。
- 工具执行与文字生成不能共用一个模糊的 loading 状态。
- 工具卡片默认折叠，展示简洁摘要；展开后显示执行详情，但不暴露内部 Prompt、隐藏推理或原始工具参数。

## 4. 组件规范

### 4.1 基础组件

| 组件 | 变体/状态 | 要求 |
|---|---|---|
| Button | primary、secondary、ghost、destructive；sm/md/lg | hover、active、focus-visible、disabled、loading；loading 时保留宽度 |
| IconButton | ghost、secondary | 必须有可访问名称；触控目标 ≥ 44px |
| Input | default、error、disabled、readonly | label、hint、error 关联；不要只用 placeholder 当 label |
| Textarea | default、error、disabled | 支持自动高度但有上限；保留换行 |
| Select | default、error、disabled | 键盘可操作；选项分组清晰 |
| Checkbox/Radio | default、error、disabled | 点击标签可选；错误状态可读 |
| Switch | default、disabled | 状态变化有文字或图标辅助，不只靠颜色 |
| Dialog | default、destructive | 焦点陷阱、Esc 关闭、遮罩点击策略明确、标题/描述关联 |
| Popover/Dropdown | default | 键盘导航、碰撞检测、关闭后焦点回到触发元素 |
| Tabs | default | 键盘左右切换；选中态不只靠颜色 |
| List | default、selected、disabled | 行高足够；分隔线克制；支持键盘 |
| Toast | success、error、info | `aria-live`；不遮挡主要操作；可关闭 |
| Badge | neutral、accent、success、warning、destructive | 只表达状态，不堆砌颜色 |
| Avatar | image、fallback | fallback 使用姓名首字母；不外链不可信图片 |
| Tooltip | default | 不承载关键信息；键盘和触摸可访问 |
| Skeleton | text、block、avatar | 形状接近真实内容；减少动态时用静态占位 |
| EmptyState | default | 说明为什么空、下一步做什么 |
| ErrorState | default、retryable | 明确错误、是否可重试、重试操作 |
| PermissionDenied | default | 说明缺少什么权限、如何申请或返回 |

### 4.2 业务组件

| 组件 | 用途 | 关键规则 |
|---|---|---|
| `AIComposer` | 自然语言输入、附件、快捷操作 | 支持发送、停止、重试；显示上下文范围；不伪造语音能力 |
| `Message` | 文本、卡片、行动预览、来源引用 | 区分用户/AI/系统；流式时保持可读；支持复制 |
| `OpportunitySummary` | 机会摘要 | 展示组织、领域、阶段、截止时间、来源与更新时间；不展示无解释分数 |
| `MatchReason` | 推荐理由 | 每条理由对应可验证证据；只展示获授权信息 |
| `ConsentPreview` | 授权预览 | 明确“将共享/不共享”、接收方、用途、有效期；确认前不可发送 |
| `ToolActivity` | 工具执行状态 | 折叠摘要、展开详情、失败可重试；不暴露内部参数 |
| `SourceReference` | 来源引用 | 可定位到来源类型和时间；不泄露私人正文 |
| `ActionPreview` | 行动预览与确认 | 绑定草稿版本；变化后要求重新预览；一次性确认 |
| `RelationshipHeader` | 关系空间头部 | 成员、建立时间、共同目标、关闭入口 |
| `MemberList` | 组织/关系成员 | 角色、状态、权限；不展示不必要的邮箱 |
| `PrivacySummary` | 我的 AI 隐私页 | 当前可见性、有效授权、已共享内容、撤销入口 |

### 4.3 状态组件

每个数据页面必须实现：

| 状态 | 视觉 | 文案要求 |
|---|---|---|
| Loading | 骨架屏或轻量进度 | 说明正在加载什么，不用全屏 spinner 阻塞 |
| Empty | 空状态图标/说明 + 下一步 | 说明为什么空，提供真实可用的下一步 |
| Error | 错误说明 + 重试 | 区分网络、权限、业务冲突、服务不可用 |
| Success | 内容或确认反馈 | 不夸大，不自动跳转打断 |
| Disabled | 降低对比度 + 原因 | 说明为什么不可用，不用“看起来能点”的按钮 |
| Permission denied | 明确说明 + 返回/申请 | 不泄露无权访问的内容 |

## 5. 页面状态规范

- 每个已实现页面必须覆盖 loading、empty、error、success、disabled、permission denied。
- 未实现页面显示“尚未开放”，不提供伪可用操作。
- 所有按钮必须有真实行为；不允许只有视觉反馈。
- 表单错误定位到字段，并在提交时汇总。
- 长文本、超长标题、空字段、网络断开、会话过期必须有布局和文案。
- 流式输出中断时保留已生成内容，并提供重试/继续。
- 删除、撤销、关闭关系等高风险操作必须二次确认，并说明后果。

## 6. 无障碍

目标：WCAG 2.2 AA。

- 正文对比度 ≥ 4.5:1；大号文字 ≥ 3:1。
- 键盘可完成所有核心操作；焦点顺序与视觉顺序一致。
- 焦点环 2px，颜色使用 `focus-ring`，与背景有足够对比。
- Dialog 焦点陷阱；关闭后焦点回到触发元素。
- 表单 label、hint、error 正确关联；错误用 `aria-describedby`。
- 图标按钮有 `aria-label`；装饰图标 `aria-hidden`。
- 流式文本使用 `aria-live="polite"`，避免频繁打断屏幕阅读器。
- 不只靠颜色传达状态；配合文字、图标或形状。
- 支持 `prefers-reduced-motion`。
- 触控目标 ≥ 44×44px；移动端考虑 Safe Area。
- 视频/音频（后续）提供字幕或文字替代。

## 7. 内容与语气

- 简洁、平静、具体；避免营销腔和夸张承诺。
- 推荐理由写“使用了哪些信息、为什么相关”，不写“AI 觉得你们很配”。
- 错误文案说明发生了什么、用户能做什么；不暴露内部堆栈、密钥或私人上下文。
- 授权文案必须明确接收方、用途、范围和有效期。
- 不用“无限”“永久”“保证”等无法兑现的词。
- 中文标点统一；中英文之间保留空格；专有名词大小写一致。

## 8. 实现映射

| 层 | 方案 | 约束 |
|---|---|---|
| 令牌 | `packages/design-tokens` | 输出 CSS Variables 与 React Native 令牌；单一来源 |
| Web 样式 | Tailwind CSS 4 `@theme` | 只引用令牌；不写散落颜色 |
| Web 组件 | shadcn/ui + Radix | 保留可访问性；按本文调整外观 |
| 图标 | Lucide | 统一尺寸和线宽 |
| Web 动效 | Motion for React | 支持减少动态 |
| 原生动效 | Reanimated | 不在 JS 线程做重布局 |
| 原生组件 | React Native + Expo | 独立实现，不强行复用 Web DOM 组件 |

令牌命名建议：

```text
--aven-color-background
--aven-color-foreground
--aven-color-accent
--aven-space-4
--aven-radius-md
--aven-font-body
--aven-duration-fast
```

M1-01 负责把本文令牌落到 `packages/design-tokens`，并用对比度工具验证浅色/深色两套值。

## 9. Do / Don't

| Do | Don't |
|---|---|
| 用留白和排版建立层级 | 用大量彩色卡片和阴影堆叠 |
| 用细边框区分表面 | 用玻璃拟态和渐变装饰 |
| 强调色只用于关键状态 | 每个模块一个主题色 |
| 推荐理由对应真实证据 | 展示无解释的匹配分数 |
| 明确展示 AI 执行状态 | 所有状态都显示“AI 正在思考” |
| 未实现功能明确说明 | 提供看起来能点的假按钮 |
| 移动端重新设计交互 | 把桌面 Sidebar 塞进手机 |
| 尊重减少动态设置 | 全屏持续动画 |

## 10. 验收清单

- [ ] 浅色/深色令牌完整，对比度通过并记录。
- [ ] 字体、间距、圆角、阴影、动效全部来自令牌。
- [ ] 桌面侧栏可收起，主区宽度和上下文面板符合规范。
- [ ] 移动端底部导航、Safe Area、键盘和返回行为验证。
- [ ] 基础组件覆盖 hover、focus、disabled、loading、error。
- [ ] 业务组件覆盖授权预览、匹配理由、工具状态和行动确认。
- [ ] 每个页面覆盖六种状态。
- [ ] 键盘、屏幕阅读器、减少动态和触控目标验证。
- [ ] 没有 Emoji 图标、无解释分数和伪交互。
- [ ] Playwright 覆盖手机宽度与桌面布局；原生设备验证 Safe Area 和键盘。
