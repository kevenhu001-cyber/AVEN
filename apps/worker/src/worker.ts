import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { LogWriter } from '@aven/config/logger';
import {
  ApiErrorResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
  RequestIdSchema,
} from '@aven/contracts';
import {
  createWorkerReadinessRuntime,
  type ReadinessResult,
  type ReadinessRuntime,
} from '@aven/service-health';

@Module({})
class WorkerModule {}

/** Nest standalone context. The HTTP listener is management-only; no queue consumer exists yet. */
export async function createWorker(
  options: { host: string; port: number },
  log: LogWriter,
  readiness: ReadinessRuntime = createWorkerReadinessRuntime(),
) {
  const context = await NestFactory.createApplicationContext(WorkerModule, { logger: false });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const parsed = RequestIdSchema.safeParse(request.headers['x-request-id']);
    const requestId = parsed.success ? parsed.data : randomUUID();
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const live = request.method === 'GET' && path === '/health/live';
    const ready = request.method === 'GET' && path === '/health/ready';
    let status = 404;
    let body: unknown;
    if (live) {
      status = 200;
      body = LivenessResponseSchema.parse({
        status: 'ok',
        service: 'worker',
        stage: 'foundation',
        request_id: requestId,
      });
    } else if (ready) {
      let result: ReadinessResult;
      try {
        result = await readiness.check();
      } catch {
        result = {
          ok: false,
          checks: { database: false, redis: false, migrations: false, consumers: false },
          retryable: true,
        };
      }
      status = result.ok ? 200 : 503;
      body = result.ok
        ? ReadinessResponseSchema.parse({
            status: 'ok',
            service: 'worker',
            stage: 'foundation',
            checks: result.checks,
            request_id: requestId,
          })
        : ApiErrorResponseSchema.parse({
            error: {
              code: 'SERVICE_NOT_READY',
              message: 'Database, Redis, migrations, or consumers are not ready.',
              request_id: requestId,
              retryable: result.retryable,
            },
          });
    } else {
      body = ApiErrorResponseSchema.parse({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found.',
          request_id: requestId,
          retryable: false,
        },
      });
    }
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
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) {
        const requestId = randomUUID();
        response.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Request-Id': requestId,
        });
        response.end(
          JSON.stringify(
            ApiErrorResponseSchema.parse({
              error: {
                code: 'INTERNAL',
                message: 'The service could not complete this request.',
                request_id: requestId,
                retryable: false,
              },
            }),
          ),
        );
      } else {
        response.end();
      }
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
      await readiness.close();
      await context.close();
    },
  };
}
