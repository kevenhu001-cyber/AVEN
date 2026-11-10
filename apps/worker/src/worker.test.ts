import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReadinessRuntime } from '@aven/service-health';
import {
  ApiErrorResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
} from '@aven/contracts';
import { createWorker } from './worker';

const notReady: ReadinessRuntime = {
  check: async () => ({
    ok: false,
    checks: { database: true, redis: true, migrations: true, consumers: false },
    retryable: true,
  }),
  close: async () => undefined,
};

describe('standalone worker management listener', () => {
  let worker: Awaited<ReturnType<typeof createWorker>>;
  let baseUrl: string;
  beforeAll(async () => {
    worker = await createWorker({ host: '127.0.0.1', port: 0 }, () => undefined, notReady);
    const address = worker.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await worker?.close();
  });
  it('keeps a real process listener live without claiming queue consumption', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(LivenessResponseSchema.parse(await response.json()).service).toBe('worker');
  });
  it('does not report unconfigured consumers ready', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);
    const body = ApiErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('SERVICE_NOT_READY');
    expect(body.error.retryable).toBe(true);
  });
  it('provides no HTTP business route', async () => {
    const response = await fetch(`${baseUrl}/api/v1/referrals`);
    expect(response.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('worker readiness with a configured consumer', () => {
  let worker: Awaited<ReturnType<typeof createWorker>>;
  let baseUrl: string;
  beforeAll(async () => {
    worker = await createWorker({ host: '127.0.0.1', port: 0 }, () => undefined, {
      check: async () => ({
        ok: true,
        checks: { database: true, redis: true, migrations: true, consumers: true },
        retryable: false,
      }),
      close: async () => undefined,
    });
    const address = worker.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await worker?.close();
  });
  it('reports ready with dependency and consumer checks', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    const body = ReadinessResponseSchema.parse(await response.json());
    expect(body.service).toBe('worker');
    expect(body.checks).toEqual({
      database: true,
      redis: true,
      migrations: true,
      consumers: true,
    });
  });
});
