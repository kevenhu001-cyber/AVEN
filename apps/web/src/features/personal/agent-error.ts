export function agentFailureText(code: unknown): string {
  if (code === 'PROVIDER_RATE_LIMITED')
    return '模型通道当前受限，可能是额度不足或请求过多。请稍后重试，或联系管理员检查额度。';
  if (code === 'PROVIDER_AUTH_FAILED') return '模型通道认证失败，请联系管理员检查配置。';
  if (code === 'PROVIDER_TIMEOUT') return '模型回复超时。本次未完成，请稍后重新提问。';
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_NOT_CONFIGURED')
    return '模型通道暂不可用，请稍后重试。';
  if (code === 'PROVIDER_INVALID_OUTPUT')
    return '模型回复意外中断，未完成的内容已清除。请稍后重新提问。';
  return '本次回复未完成，或来源授权已变化。请重新确认后发起新对话。';
}
