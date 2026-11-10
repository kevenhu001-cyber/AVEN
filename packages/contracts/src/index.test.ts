import { describe, expect, it } from 'vitest';
import { ApiErrorResponseSchema, LivenessResponseSchema, ReadinessResponseSchema } from './index';

const requestId = 'b434644d-d195-4978-b457-765c6d9b755e';
describe('public engineering contracts', () => {
  it('distinguishes live from business readiness', () => {
    expect(
      LivenessResponseSchema.parse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        request_id: requestId,
      }).stage,
    ).toBe('foundation');
    expect(
      LivenessResponseSchema.safeParse({ status: 'ready', service: 'api', request_id: requestId })
        .success,
    ).toBe(false);
  });
  it('rejects accidental output additions and invalid request IDs', () => {
    expect(
      LivenessResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        request_id: 'unsafe-id',
        token: 'private',
      }).success,
    ).toBe(false);
  });
  it('requires a known error code and retry semantics', () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        error: { code: 'INTERNAL', message: 'Unavailable', request_id: requestId },
      }).success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.parse({
        error: {
          code: 'SERVICE_NOT_READY',
          message: 'Not configured',
          request_id: requestId,
          retryable: false,
        },
      }).error.code,
    ).toBe('SERVICE_NOT_READY');
  });
  it('requires explicit readiness checks and rejects unknown ones', () => {
    expect(
      ReadinessResponseSchema.parse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        checks: { database: true, redis: true, migrations: true },
        request_id: requestId,
      }).checks.database,
    ).toBe(true);
    expect(
      ReadinessResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        checks: { database: true, redis: true, migrations: true, secret: true },
        request_id: requestId,
      }).success,
    ).toBe(false);
  });
});
