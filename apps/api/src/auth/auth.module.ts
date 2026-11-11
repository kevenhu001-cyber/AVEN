import { Module } from '@nestjs/common';
import { parseApiEnvironment } from '@aven/config/env';
import type { ApiEnvironment } from '@aven/config/env';
import { API_ENVIRONMENT, MAILER } from './auth.constants.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { createMailer } from './mailer.js';
import { AuthRateLimiter } from './rate-limit.js';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: API_ENVIRONMENT,
      useFactory: (): ApiEnvironment => parseApiEnvironment(process.env),
    },
    {
      provide: MAILER,
      useFactory: (env: ApiEnvironment) => createMailer(env),
      inject: [API_ENVIRONMENT],
    },
    AuthRateLimiter,
    AuthService,
    AuthGuard,
  ],
  exports: [AuthService, AuthGuard, API_ENVIRONMENT, MAILER],
})
export class AuthModule {}
