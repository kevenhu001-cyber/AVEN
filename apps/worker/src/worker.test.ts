import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorResponseSchema, LivenessResponseSchema } from '@aven/contracts';
import { createWorker } from './worker';

describe('standalone worker management listener', () => {
  let worker: Awaited<ReturnType<typeof createWorker>>;
  let baseUrl: string;
  beforeAll(async () => {
    worker = await createWorker({ host: '127.0.0.1', port: 0 }, () => undefined);
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
    expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'SERVICE_NOT_READY',
    );
  });
  it('provides no HTTP business route', async () => {
    const response = await fetch(`${baseUrl}/api/v1/referrals`);
    expect(response.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });
});
