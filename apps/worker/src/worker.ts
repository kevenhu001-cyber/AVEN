import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { LogWriter } from '@aven/config/logger';
import { ApiErrorResponseSchema, LivenessResponseSchema, RequestIdSchema } from '@aven/contracts';

@Module({})
class WorkerModule {}

/** Nest standalone context. The HTTP listener is management-only; no queue consumer exists yet. */
export async function createWorker(options: { host: string; port: number }, log: LogWriter) {
  const context = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  const server = createServer((request, response) => {
    const parsed = RequestIdSchema.safeParse(request.headers['x-request-id']);
    const requestId = parsed.success ? parsed.data : randomUUID();
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const live = request.method === 'GET' && path === '/health/live';
    const ready = request.method === 'GET' && path === '/health/ready';
    const status = live ? 200 : ready ? 503 : 404;
    const body = live
      ? LivenessResponseSchema.parse({
          status: 'ok',
          service: 'worker',
          stage: 'foundation',
          request_id: requestId,
        })
      : ApiErrorResponseSchema.parse({
          error: {
            code: ready ? 'SERVICE_NOT_READY' : 'NOT_FOUND',
            message: ready
              ? 'Queue consumers and dependencies are not configured.'
              : 'Resource not found.',
            request_id: requestId,
            retryable: false,
          },
        });
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(body));
    log({
      level: status >= 500 ? 'error' : 'info',
      event: 'worker.health',
      request_id: requestId,
      status,
      route: live || ready ? path : 'unmatched',
      method: request.method ?? 'UNKNOWN',
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, options.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await context.close();
    throw error;
  }
  return {
    server,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await context.close();
    },
  };
}
