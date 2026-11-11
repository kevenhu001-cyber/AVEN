import { describe, expect, it } from 'vitest';
import { hashPassword, verifyDummyPassword, verifyPassword } from './password';

describe('Argon2id password handling', () => {
  it('hashes with Argon2id and verifies the correct password', async () => {
    const hash = await hashPassword('Correct Horse Battery Staple 42!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Correct Horse Battery Staple 42!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });
  it('does not throw for malformed hashes', async () => {
    expect(await verifyPassword('not-a-hash', 'password')).toBe(false);
  });
  it('performs a dummy verification for unknown accounts', async () => {
    await expect(verifyDummyPassword('unknown')).resolves.toBeUndefined();
  });
});
