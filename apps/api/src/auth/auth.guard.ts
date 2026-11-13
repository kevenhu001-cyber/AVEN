import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiEnvironment } from '@aven/config/env';
import { API_ENVIRONMENT, IS_PUBLIC } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { csrfCookieName, readCookie, sessionCookieName } from './cookies.js';
import { sha256 } from './tokens.js';

function readBearer(request: AuthenticatedRequest): string | undefined {
  const header = request.header('authorization');
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(API_ENVIRONMENT) private readonly env: ApiEnvironment,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearer(request) ?? readCookie(request, sessionCookieName);

    if (isPublic) {
      if (token) {
        const auth = await this.auth.sessionLookup(sha256(token));
        if (auth) {
          request.auth = auth;
        }
      }
      return true;
    }

    if (!token) throw new UnauthorizedException();
    const auth = await this.auth.sessionLookup(sha256(token));
    if (!auth) throw new UnauthorizedException();

    if (auth.client === 'web' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.header('origin');
      if (
        origin &&
        origin !== this.env.WEB_ORIGIN &&
        origin !== 'http://127.0.0.1:3000' &&
        origin !== 'http://localhost:3000'
      )
        throw new ForbiddenException();
      const header = request.header('x-csrf-token');
      const cookie = readCookie(request, csrfCookieName);
      if (
        !header ||
        !cookie ||
        header !== cookie ||
        !auth.csrfTokenHash ||
        sha256(header) !== auth.csrfTokenHash
      ) {
        throw new ForbiddenException('CSRF token is invalid.');
      }
    }

    request.auth = auth;
    return true;
  }
}
