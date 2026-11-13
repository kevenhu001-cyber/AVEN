import { describe, expect, it } from 'vitest';
import { AdminConfigInputSchema } from './index.js';
describe('platform configuration boundary', () => {
  const input = {
    baseUrl: 'https://ai.example.test/v1',
    model: 'example-model',
    apiKey: 'synthetic-secret',
    expectedVersion: 0,
  };
  it('accepts a configuration without exposing credentials in metadata', () => {
    expect(AdminConfigInputSchema.safeParse(input).success).toBe(true);
  });
  it('rejects credentials, insecure URLs, fragments and query strings', () => {
    for (const baseUrl of [
      'http://ai.example.test',
      'https://user:pass@ai.example.test',
      'https://ai.example.test?key=secret',
      'https://ai.example.test#secret',
    ])
      expect(AdminConfigInputSchema.safeParse({ ...input, baseUrl }).success).toBe(false);
  });
  it('rejects negative versions and unexpected activation controls', () => {
    expect(AdminConfigInputSchema.safeParse({ ...input, expectedVersion: -1 }).success).toBe(false);
    expect(AdminConfigInputSchema.safeParse({ ...input, enabled: true }).success).toBe(false);
  });
});
