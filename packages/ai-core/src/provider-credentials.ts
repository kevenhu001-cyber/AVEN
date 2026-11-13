import { createDecipheriv } from 'node:crypto';
import { AIError } from './errors.js';
export function decryptProviderKey(
  encrypted: string,
  userId: string,
  encodedKey: string | undefined,
): string {
  try {
    if (!encodedKey || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) throw new Error('KEY');
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('KEY');
    const [version, nonce, tag, ciphertext, extra] = encrypted.split('.');
    if (version !== 'v1' || !nonce || !tag || !ciphertext || extra !== undefined)
      throw new Error('CIPHERTEXT');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
    decipher.setAAD(Buffer.from(`aven:user-ai-provider:v1:${userId}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AIError('PROVIDER_NOT_CONFIGURED', 'Provider credentials are unavailable.');
  }
}
