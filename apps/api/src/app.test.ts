import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiErrorResponseSchema, LivenessResponseSchema, RequestIdSchema } from '@aven/contracts';
import { parseApiEnvironment } from '@aven/config/env';
import type { LogEntry } from '@aven/config/logger';
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
  beforeAll(async () => {
    app = await createApiApplication(
      parseApiEnvironment({ APP_ENV: 'test' }),
      (entry) => logs.push(entry),
      TestModule,
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
  it('fails readiness explicitly before dependencies and consumers exist', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(await response.json()).error).toMatchObject({
      code: 'SERVICE_NOT_READY',
      retryable: false,
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
