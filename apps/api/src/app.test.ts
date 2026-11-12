import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ApiErrorResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
  RequestIdSchema,
} from '@aven/contracts';
import { parseApiEnvironment } from '@aven/config/env';
import type { LogEntry } from '@aven/config/logger';
import type { ReadinessRuntime } from '@aven/service-health';
import { AppModule } from './app.module';
import { createApiApplication } from './app';

@Controller('__test')
class FailureController {
  @Get('crash') crash(): never {
    throw new Error('password=private-value; SELECT * FROM credentials');
  }
}
@Module({ imports: [AppModule], controllers: [FailureController] })
class TestModule {}

describe('API skeleton over real HTTP', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  const logs: LogEntry[] = [];
  const readiness: ReadinessRuntime = {
    check: async () => ({
      ok: false,
      checks: { database: false, redis: false, migrations: false },
      retryable: true,
    }),
    close: async () => undefined,
  };
  beforeAll(async () => {
    app = await createApiApplication(
      parseApiEnvironment({ APP_ENV: 'test' }),
      (entry) => logs.push(entry),
      TestModule,
      readiness,
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('reports liveness, not readiness, and preserves a valid request ID', async () => {
    const id = 'b434644d-d195-4978-b457-765c6d9b755e';
    const response = await fetch(`${baseUrl}/health/live`, { headers: { 'X-Request-Id': id } });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(id);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = LivenessResponseSchema.parse(await response.json());
    expect(result).toMatchObject({ service: 'api', stage: 'foundation', request_id: id });
  });
  it('replaces an invalid supplied ID', async () => {
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { 'X-Request-Id': 'private-untrusted-input' },
    });
    expect(RequestIdSchema.safeParse(response.headers.get('x-request-id')).success).toBe(true);
  });
  it('fails readiness explicitly when dependencies are not ready', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(await response.json()).error).toMatchObject({
      code: 'SERVICE_NOT_READY',
      retryable: true,
    });
  });
  it('uses uniform errors and does not echo unknown URLs', async () => {
    const response = await fetch(`${baseUrl}/not-implemented?token=private-query`);
    expect(response.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(logs)).not.toContain('private-query');
  });
  it('does not expose internal errors, SQL, or stack traces', async () => {
    const response = await fetch(`${baseUrl}/__test/crash`);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('private-value');
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('stack');
    expect(ApiErrorResponseSchema.parse(JSON.parse(text)).error.code).toBe('INTERNAL');
  });
  it('requires authentication for user provider configuration and plugin routes', async () => {
    const cases = [
      { method: 'GET', path: '/api/v1/agent/provider' },
      { method: 'PUT', path: '/api/v1/agent/provider' },
      { method: 'DELETE', path: '/api/v1/agent/provider?version=1' },
      { method: 'GET', path: '/api/v1/plugins' },
      { method: 'GET', path: '/api/v1/plugins/mcp/servers' },
      { method: 'POST', path: '/api/v1/plugins/mcp/servers' },
      { method: 'POST', path: '/api/v1/plugins/amap.maps/invoke' },
    ];
    for (const item of cases) {
      const response = await fetch(`${baseUrl}${item.path}`, { method: item.method });
      expect(response.status).toBe(401);
    }
  });
  it('allows only the configured browser origin', async () => {
    const allowed = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const blocked = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('API readiness when dependencies are available', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => {
    app = await createApiApplication(
      parseApiEnvironment({ APP_ENV: 'test' }),
      () => undefined,
      AppModule,
      {
        check: async () => ({
          ok: true,
          checks: { database: true, redis: true, migrations: true },
          retryable: false,
        }),
        close: async () => undefined,
      },
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('reports dependency checks without exposing connection details', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = ReadinessResponseSchema.parse(await response.json());
    expect(body.service).toBe('api');
    expect(body.checks).toEqual({ database: true, redis: true, migrations: true });
    expect(JSON.stringify(body)).not.toContain('postgres');
    expect(JSON.stringify(body)).not.toContain('redis://');
  });
});
