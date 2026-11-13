import { AIError, MockProvider, type AIProvider } from '@aven/ai-core';
export function providerForRun(
  configured: AIProvider,
  run: { provider: string; model: string; personal: boolean },
): AIProvider {
  if (run.provider === 'mock')
    return configured.metadata.mock && configured.metadata.model === run.model
      ? configured
      : new MockProvider({ model: run.model });
  if (!run.personal)
    throw new AIError('TOOL_SCOPE_DENIED', 'External organization runs are not enabled.');
  if (
    configured.metadata.mock ||
    run.provider !== configured.metadata.provider ||
    run.model !== configured.metadata.model
  )
    throw new AIError('PROVIDER_NOT_CONFIGURED', 'Run provider configuration has changed.');
  return configured;
}
