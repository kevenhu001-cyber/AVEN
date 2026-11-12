import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { CalendarOAuthProvider } from '@aven/contracts';
import { ServiceNotReadyException } from '../http-errors.js';

export type OAuthTokenPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scope?: string;
  tokenType: string;
};

type CalendarOAuthStatePayload = {
  principalId: string;
  provider: string;
  nonce: string;
  expMs: number;
};

function assertOAuthTokenPayload(raw: unknown): OAuthTokenPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Malformed token payload');
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.accessToken !== 'string' ||
    obj.accessToken.length < 1 ||
    obj.accessToken.length > 4096 ||
    typeof obj.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(obj.expiresAt))
  ) {
    throw new Error('Malformed token fields');
  }
  if (obj.refreshToken !== undefined && typeof obj.refreshToken !== 'string') {
    throw new Error('Invalid refreshToken');
  }
  if (obj.scope !== undefined && typeof obj.scope !== 'string') {
    throw new Error('Invalid scope');
  }
  if (obj.tokenType !== undefined && typeof obj.tokenType !== 'string') {
    throw new Error('Invalid tokenType');
  }
  return {
    accessToken: obj.accessToken,
    ...(obj.refreshToken !== undefined ? { refreshToken: obj.refreshToken } : {}),
    expiresAt: obj.expiresAt,
    ...(obj.scope !== undefined ? { scope: obj.scope } : {}),
    tokenType: obj.tokenType ?? 'Bearer',
  };
}

function assertOAuthStatePayload(raw: unknown): CalendarOAuthStatePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Malformed state payload');
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.principalId !== 'string' ||
    typeof obj.provider !== 'string' ||
    typeof obj.nonce !== 'string' ||
    typeof obj.expMs !== 'number' ||
    !Number.isFinite(obj.expMs)
  ) {
    throw new Error('Invalid state fields');
  }
  return {
    principalId: obj.principalId,
    provider: obj.provider,
    nonce: obj.nonce,
    expMs: obj.expMs,
  };
}

const DEV_EPHEMERAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const DEV_EPHEMERAL_STATE_SECRET = randomBytes(32).toString('base64url');

function isProductionEnv(): boolean {
  return process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
}

export function resolveCalendarEncryptionKey(configured?: string): Buffer {
  const candidate =
    configured ?? process.env.CALENDAR_OAUTH_CONFIG_KEY ?? process.env.AI_USER_CONFIG_KEY;
  if (!candidate) {
    if (isProductionEnv()) {
      throw new ServiceNotReadyException();
    }
    return Buffer.from(DEV_EPHEMERAL_ENCRYPTION_KEY, 'base64');
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(candidate)) {
    throw new ServiceNotReadyException();
  }
  const key = Buffer.from(candidate, 'base64');
  if (key.length !== 32 || key.toString('base64') !== candidate) {
    throw new ServiceNotReadyException();
  }
  return key;
}

export function resolveOAuthStateSecret(configured?: string): string {
  const candidate =
    configured ?? process.env.CALENDAR_OAUTH_STATE_SECRET ?? process.env.AUTH_IP_SALT;
  if (!candidate || candidate.trim().length < 16) {
    if (isProductionEnv()) {
      throw new ServiceNotReadyException();
    }
    return DEV_EPHEMERAL_STATE_SECRET;
  }
  return candidate;
}

function buildAad(principalId: string, provider: CalendarOAuthProvider): Buffer {
  return Buffer.from(`aven:calendar-oauth:v1:${principalId}:${provider}`, 'utf8');
}

export function encryptCalendarTokenPayload(
  payload: OAuthTokenPayload,
  principalId: string,
  provider: CalendarOAuthProvider,
  configuredKey?: string,
  keyVersion = 1,
): string {
  const validated = assertOAuthTokenPayload(payload);
  const key = resolveCalendarEncryptionKey(configuredKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(buildAad(principalId, provider));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(validated), 'utf8'),
    cipher.final(),
  ]);
  return [
    `v${keyVersion}`,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptCalendarTokenPayload(
  ciphertext: string,
  principalId: string,
  provider: CalendarOAuthProvider,
  configuredKey?: string,
): OAuthTokenPayload {
  if (!ciphertext || ciphertext === '[REVOKED]') {
    throw new UnauthorizedException('Calendar connection has been revoked.');
  }
  const parts = ciphertext.split('.');
  if (parts.length !== 4 || !parts[0]?.startsWith('v')) {
    throw new UnprocessableEntityException('Invalid encrypted calendar credentials format.');
  }
  const [, nonceB64, tagB64, dataB64] = parts;
  if (!nonceB64 || !tagB64 || !dataB64) {
    throw new UnprocessableEntityException('Corrupted calendar credentials payload.');
  }

  const key = resolveCalendarEncryptionKey(configuredKey);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceB64, 'base64url'));
  decipher.setAAD(buildAad(principalId, provider));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return assertOAuthTokenPayload(JSON.parse(plaintext));
  } catch {
    throw new UnprocessableEntityException('Unable to decrypt calendar credentials.');
  }
}

export function signCalendarOAuthState(
  input: {
    principalId: string;
    provider: CalendarOAuthProvider;
    ttlSeconds?: number;
  },
  configuredSecret?: string,
): { stateToken: string; expiresAt: string } {
  const secret = resolveOAuthStateSecret(configuredSecret);
  const expMs = Date.now() + (input.ttlSeconds ?? 600) * 1000;
  const payload = {
    principalId: input.principalId,
    provider: input.provider,
    nonce: randomBytes(12).toString('base64url'),
    expMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return {
    stateToken: `${encoded}.${sig}`,
    expiresAt: new Date(expMs).toISOString(),
  };
}

export function verifyCalendarOAuthState(
  stateToken: string,
  expectedPrincipalId: string,
  expectedProvider: CalendarOAuthProvider,
  configuredSecret?: string,
): void {
  const parts = stateToken.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new UnauthorizedException('Invalid OAuth state token.');
  }
  const [encoded, providedSig] = parts;
  const secret = resolveOAuthStateSecret(configuredSecret);
  const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedException('OAuth state signature verification failed.');
  }

  let parsed: CalendarOAuthStatePayload;
  try {
    const rawJson = Buffer.from(encoded, 'base64url').toString('utf8');
    parsed = assertOAuthStatePayload(JSON.parse(rawJson));
  } catch {
    throw new UnauthorizedException('Malformed OAuth state payload.');
  }

  if (parsed.expMs <= Date.now()) {
    throw new UnauthorizedException('OAuth state token has expired.');
  }
  if (parsed.principalId !== expectedPrincipalId || parsed.provider !== expectedProvider) {
    throw new UnauthorizedException(
      'OAuth state token does not match current session or provider.',
    );
  }
}
