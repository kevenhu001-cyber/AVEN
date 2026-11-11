import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiEnvironment } from '@aven/config/env';
import {
  AuthResponseSchema,
  ChangePasswordSchema,
  LoginRequestSchema,
  MeResponseSchema,
  OkResponseSchema,
  PasswordResetRequestSchema,
  PasswordResetSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  RequestIdSchema,
  SessionListResponseSchema,
  VerifyEmailRequestSchema,
} from '@aven/contracts';
import { API_ENVIRONMENT } from './auth.constants.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthContext, RequestContext } from './auth.types.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { CurrentAuth } from './current-auth.decorator.js';
import { Public } from './public.decorator.js';

type Parser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

function parse<T>(schema: Parser<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UnprocessableEntityException('Invalid request.');
  return result.data;
}

function requestContext(request: Request): RequestContext {
  return {
    ip: request.ip ?? request.socket.remoteAddress ?? 'unknown',
    userAgent: request.header('user-agent') ?? '',
  };
}

@Controller('api/v1/auth')
@UseGuards(AuthGuard)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(API_ENVIRONMENT) private readonly env: ApiEnvironment,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() body: unknown, @Req() request: Request) {
    const input = parse(RegisterRequestSchema, body);
    return RegisterResponseSchema.parse(await this.auth.register(input, requestContext(request)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parse(LoginRequestSchema, body);
    const result = await this.auth.login(input, requestContext(request));
    if (input.client === 'web') {
      setSessionCookies(
        response,
        this.env,
        result.sessionToken,
        result.csrfToken,
        this.env.AUTH_SESSION_TTL_DAYS * 86400,
      );
      return AuthResponseSchema.parse({
        user: result.user,
        session: result.session,
        csrfToken: result.csrfToken,
      });
    }
    return AuthResponseSchema.parse({
      user: result.user,
      session: result.session,
      sessionToken: result.sessionToken,
    });
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(auth);
    clearSessionCookies(response, this.env);
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    return MeResponseSchema.parse(await this.auth.me(auth));
  }

  @Get('sessions')
  async sessions(@CurrentAuth() auth: AuthContext) {
    return SessionListResponseSchema.parse(await this.auth.listSessions(auth));
  }

  @Post('sessions/:id/revoke')
  @HttpCode(204)
  async revokeSession(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    const parsed = RequestIdSchema.safeParse(id);
    if (!parsed.success) throw new UnprocessableEntityException('Invalid session id.');
    await this.auth.revokeSession(auth, parsed.data);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown, @Req() request: Request) {
    const input = parse(VerifyEmailRequestSchema, body);
    await this.auth.verifyEmail(input.token, requestContext(request));
    return OkResponseSchema.parse({ ok: true });
  }

  @Public()
  @Post('password/reset-request')
  @HttpCode(202)
  async requestPasswordReset(@Body() body: unknown, @Req() request: Request) {
    const input = parse(PasswordResetRequestSchema, body);
    await this.auth.requestPasswordReset(input.email, requestContext(request));
    return OkResponseSchema.parse({ ok: true });
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async resetPassword(@Body() body: unknown, @Req() request: Request): Promise<void> {
    const input = parse(PasswordResetSchema, body);
    await this.auth.resetPassword(input.token, input.password, requestContext(request));
  }

  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const input = parse(ChangePasswordSchema, body);
    await this.auth.changePassword(auth, input.currentPassword, input.newPassword);
    clearSessionCookies(response, this.env);
  }
}
