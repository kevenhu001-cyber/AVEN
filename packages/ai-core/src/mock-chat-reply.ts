import type { AIMessage } from './provider.js';
/** Deterministic UI examples only. Never infer facts from retrieved context. */
export function mockChatReply(messages: AIMessage[]): string {
  const input =
    [...messages]
      .reverse()
      .find((message) => message.role === 'user' && !message.name)
      ?.content.toLowerCase() ?? '';
  if (/outlook|gmail|邮箱|邮件|连接器|连接.*工具/.test(input))
    return '目前还不能读取你的邮箱或连接外部账号。\n\n点击输入框左侧的 **＋**，可以查看连接器目录和模拟示例；真实 OAuth 尚未接通。\n\n如果只是想整理邮件，可以先提供一段不含敏感信息的示例。\n\n这是 Mock 演示，没有登录邮箱、读取邮件或发送内容。';
  if (/记忆|上下文|记住/.test(input))
    return '你可以在底部的 **记忆** 中管理自己的信息。\n\n1. **新增**：写下你想保留的兴趣、技能或偏好。\n2. **确认用途**：只有你允许的信息才可用于对应场景，默认不授权。\n3. **随时调整**：检查、编辑或撤回已经确认的信息。\n\n这条 Mock 回复不会自动保存记忆；保存前仍需要你明确确认。';
  if (/学习|计划|安排|目标|规划/.test(input))
    return '可以先用下面的框架理清计划：\n\n1. **明确目标**：选出今天最重要的一件事，写下完成标准。\n2. **安排时间**：留出 2–3 个专注时段，中间安排休息。\n3. **检查进展**：结束时用 5 分钟回顾，记录卡住的地方。\n\n你希望完成什么，今天大概能投入多久？\n\n这是 Mock 规划示例，不会创建日历或自动追踪目标。';
  if (/^(你好|您好|嗨|hello|hi|hey)[！!。\s]*$/.test(input.trim()))
    return '你好，我是 AVEN。\n\n可以从一个想法开始，也可以先整理自己的记忆、查看已有连接。\n\n当前是 **Mock 演示**，回复来自预设示例，还不具备真实模型的理解与推理能力。';
  return '目前是 **Mock 演示**，我还不能像真实模型一样回答这个问题。\n\n你可以先体验：\n\n- **记忆**：手动整理信息，并确认使用范围。\n- **连接**：查看邀请、已有连接和消息。\n- **连接器**：从输入框左侧的 ＋ 查看工具与模拟示例。\n\n这些入口的操作需要你明确发起；这条回复没有执行任何外部动作。';
}
