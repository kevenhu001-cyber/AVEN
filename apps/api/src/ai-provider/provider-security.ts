import { publicProviderUrl } from '@aven/ai-core';
import { createCipheriv, randomBytes } from 'node:crypto';
import { ServiceNotReadyException } from '../http-errors.js';
import { UnprocessableEntityException } from '@nestjs/common';

export function encryptProviderKey(
  secret: string,
  userId: string,
  encodedKey: string | undefined,
): string {
  if (!encodedKey || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) throw new ServiceNotReadyException();
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey)
    throw new ServiceNotReadyException();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`aven:user-ai-provider:v1:${userId}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function approvedProviderUrl(value: string, allowed: string | undefined): string {
  if (!allowed?.trim()) throw new ServiceNotReadyException();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnprocessableEntityException('Invalid provider URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new UnprocessableEntityException('Invalid provider URL.');
  }
  const normalized = url.href.replace(/\/+$/, '');
  if (allowed.trim() === 'public_https') {
    try {
      return publicProviderUrl(normalized);
    } catch {
      throw new UnprocessableEntityException(
        'Only a public HTTPS provider on port 443 is supported.',
      );
    }
  }
  const allowlist = allowed.split(',').map((item) => item.trim().replace(/\/+$/, ''));
  if (!allowlist.includes(normalized))
    throw new UnprocessableEntityException('Provider URL is not enabled.');
  return normalized;
}
