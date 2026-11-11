import type { Request, Response } from 'express';
import type { ApiEnvironment } from '@aven/config/env';

export const sessionCookieName = 'aven_session';
export const csrfCookieName = 'aven_csrf';

function cookieOptions(env: ApiEnvironment, httpOnly: boolean, maxAgeSeconds?: number): string[] {
  const parts = [
    'Path=/',
    'SameSite=Lax',
    httpOnly ? 'HttpOnly' : '',
    env.APP_ENV === 'production' ? 'Secure' : '',
  ].filter(Boolean);
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setSessionCookies(
  response: Response,
  env: ApiEnvironment,
  sessionToken: string,
  csrfToken: string,
  maxAgeSeconds: number,
): void {
  response.append(
    'Set-Cookie',
    `${sessionCookieName}=${encodeURIComponent(sessionToken)}; ${cookieOptions(env, true, maxAgeSeconds).join('; ')}`,
  );
  response.append(
    'Set-Cookie',
    `${csrfCookieName}=${encodeURIComponent(csrfToken)}; ${cookieOptions(env, false, maxAgeSeconds).join('; ')}`,
  );
}

export function clearSessionCookies(response: Response, env: ApiEnvironment): void {
  response.append('Set-Cookie', `${sessionCookieName}=; ${cookieOptions(env, true, 0).join('; ')}`);
  response.append('Set-Cookie', `${csrfCookieName}=; ${cookieOptions(env, false, 0).join('; ')}`);
}
