import { describe, expect, it } from 'vitest';
import { agentFailureText } from './agent-error';
describe('real model failures', () => {
  it('explains upstream limits without fabricating source conflicts', () => {
    expect(agentFailureText('PROVIDER_RATE_LIMITED')).toContain('额度');
    expect(agentFailureText('PROVIDER_RATE_LIMITED')).not.toContain('授权已变化');
  });
  it('keeps unknown provider details private', () => {
    expect(agentFailureText('private-upstream-response')).not.toContain(
      'private-upstream-response',
    );
  });
  it('explains a truncated model stream', () => {
    expect(agentFailureText('PROVIDER_INVALID_OUTPUT')).toContain('未完成的内容已清除');
  });
});
