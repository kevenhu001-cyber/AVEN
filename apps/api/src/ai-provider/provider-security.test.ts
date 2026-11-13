import { createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { approvedProviderUrl, encryptProviderKey } from './provider-security.js';

describe('user provider configuration security', () => {
  const key = randomBytes(32).toString('base64');
  it('encrypts with a fresh nonce and authenticates the owner', () => {
    const first = encryptProviderKey('test-secret', 'user-one', key);
    const second = encryptProviderKey('test-secret', 'user-one', key);
    expect(first).not.toBe(second);
    expect(first).not.toContain('test-secret');
    const [version, iv, tag, ciphertext] = first.split('.');
    expect(version).toBe('v1');
    function decrypt(userId: string) {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'base64'),
        Buffer.from(iv!, 'base64url'),
      );
      decipher.setAAD(Buffer.from(`aven:user-ai-provider:v1:${userId}`));
      decipher.setAuthTag(Buffer.from(tag!, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext!, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    }
    expect(decrypt('user-one')).toBe('test-secret');
    expect(() => decrypt('user-two')).toThrow();
  });
  it('fails closed when the encryption key is missing or invalid', () => {
    expect(() => encryptProviderKey('secret', 'user', undefined)).toThrow();
    expect(() => encryptProviderKey('secret', 'user', 'invalid')).toThrow();
  });
  it('only accepts explicitly enabled HTTPS URLs without credentials or parameters', () => {
    const allowed = 'https://ai.example.test/v1';
    expect(approvedProviderUrl(`${allowed}/`, allowed)).toBe(allowed);
    for (const url of [
      'http://ai.example.test/v1',
      'https://user:pass@ai.example.test/v1',
      'https://ai.example.test/v1?x=y',
      'https://ai.example.test/v1#x',
      'https://evil.test/v1',
    ]) {
      expect(() => approvedProviderUrl(url, allowed)).toThrow();
    }
    expect(() => approvedProviderUrl(allowed, undefined)).toThrow();
  });
});

it('allows public user URLs only with the explicit public_https policy', () => {
  expect(approvedProviderUrl('https://api.channel.org/v1/', 'public_https')).toBe(
    'https://api.channel.org/v1',
  );
  for (const value of [
    'https://127.0.0.1/v1',
    'https://service.internal/v1',
    'https://api.channel.org:8443/v1',
  ])
    expect(() => approvedProviderUrl(value, 'public_https')).toThrow();
});
