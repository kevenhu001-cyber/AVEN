import { createDecipheriv } from 'node:crypto';
import { AIError } from './errors.js';

/**
 * Decrypts a provider key produced by the API's `encryptProviderKey`.
 *
 * Stored format: `v1.<iv base64url>.<tag base64url>.<ciphertext base64url>`.
 * The associated data binds the key to its owner so a row copied to another
 * account cannot be decrypted with the same server key.
 */
export function decryptProviderKey(
  encrypted: string,
  associatedData: string,
  encodedKey: string | undefined,
): string {
  if (!encodedKey || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new AIError('PROVIDER_NOT_CONFIGURED', 'The provider encryption key is not configured.');
  }
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new AIError('PROVIDER_NOT_CONFIGURED', 'The provider encryption key is invalid.');
  }
  const [version, iv, tag, data] = encrypted.split('.');
  if (version !== 'v1' || !iv || !tag || !data) {
    throw new AIError('PROVIDER_NOT_CONFIGURED', 'The stored provider key is invalid.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AIError('PROVIDER_NOT_CONFIGURED', 'The stored provider key could not be read.');
  }
}

export function providerKeyAssociatedData(owner: string): string {
  return `aven:user-ai-provider:v1:${owner}`;
}
