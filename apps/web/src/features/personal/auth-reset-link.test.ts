import { describe, expect, it } from 'vitest';
import { parseResetFragment } from './auth-reset-link';
describe('mail reset fragment', () => {
  it('accepts exactly one URL-safe token', () => {
    const token = 'aB_9-'.repeat(9);
    expect(parseResetFragment(`#reset_token=${token}`)).toBe(token);
  });
  it.each([
    '#reset_token=short',
    `#reset_token=${'a'.repeat(43)}&reset_token=${'b'.repeat(43)}`,
    `#reset_token=${'a'.repeat(43)}%20`,
    '#unrelated=value',
  ])('rejects ambiguous or invalid fragments', (fragment) => {
    expect(parseResetFragment(fragment)).toBeNull();
  });
});
