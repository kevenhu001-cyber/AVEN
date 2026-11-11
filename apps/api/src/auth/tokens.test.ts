import { describe, expect, it } from 'vitest';
import { hashIp, randomToken, sha256 } from './tokens';

describe('opaque session tokens', () => {
  it('generates unique base64url tokens with stable SHA-256 hashes', () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sha256(first)).toHaveLength(64);
    expect(sha256(first)).toBe(sha256(first));
    expect(sha256(first)).not.toBe(sha256(second));
  });
  it('hashes IP addresses with a salt', () => {
    expect(hashIp('127.0.0.1', 'salt')).toBe(hashIp('127.0.0.1', 'salt'));
    expect(hashIp('127.0.0.1', 'salt')).not.toBe(hashIp('127.0.0.2', 'salt'));
    expect(hashIp('127.0.0.1', 'salt')).not.toBe(hashIp('127.0.0.1', 'other'));
  });
});
