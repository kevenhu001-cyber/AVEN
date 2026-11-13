import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import type { ApiEnvironment } from '@aven/config/env';
import type { LogWriter } from '@aven/config/logger';
import { RequestIdSchema } from '@aven/contracts';
import {
  configureReadiness,
  createReadinessRuntime,
  type ReadinessRuntime,
} from '@aven/service-health';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './http-errors';

export async function createApiApplication(
  env: ApiEnvironment,
  log: LogWriter,
  rootModule: Type<unknown> = AppModule,
  readiness: ReadinessRuntime = createReadinessRuntime(),
): Promise<NestExpressApplication> {
  configureReadiness(readiness);
  const app = await NestFactory.create<NestExpressApplication>(rootModule, { logger: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((request: Request, response: Response, next: NextFunction) => {
    const parsed = RequestIdSchema.safeParse(request.header('X-Request-Id'));
    const requestId = parsed.success ? parsed.data : randomUUID();
    const started = performance.now();
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.once('finish', () => {
      const route = ['/health/live', '/health/ready'].includes(request.path)
        ? request.path
        : 'unmatched';
      log({
        level: response.statusCode >= 500 ? 'error' : 'info',
        event: 'http.completed',
        request_id: requestId,
        method: request.method,
        route,
        status: response.statusCode,
        latency_ms: Math.round(performance.now() - started),
      });
    });
    next();
  });
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) =>
      callback(
        null,
        origin === undefined ||
          origin === env.WEB_ORIGIN ||
          origin === 'http://127.0.0.1:3000' ||
          origin === 'http://localhost:3000',
      ),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  const close = app.close.bind(app);
  app.close = async () => {
    await readiness.close();
    await close();
  };
  await app.init();
  return app;
}
