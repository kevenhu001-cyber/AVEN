import { describe, expect, it } from 'vitest';
import {
  ApiErrorResponseSchema,
  AuthResponseSchema,
  CampusMembershipSchema,
  LivenessResponseSchema,
  LoginRequestSchema,
  PasswordSchema,
  ReadinessResponseSchema,
  RegisterRequestSchema,
  UpdateProfileRequestSchema,
} from './index';

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
  it('normalizes email and rejects short passwords', () => {
    const parsed = RegisterRequestSchema.parse({
      email: '  User@Example.Test ',
      password: 'Correct Horse Battery 42!',
      displayName: '张雨',
    });
    expect(parsed.email).toBe('user@example.test');
    expect(PasswordSchema.safeParse('too-short').success).toBe(false);
    expect(
      LoginRequestSchema.parse({
        email: 'user@example.test',
        password: 'x',
      }).client,
    ).toBe('web');
  });
  it('accepts either a CSRF token or a mobile session token, not unknown fields', () => {
    const base = {
      user: {
        id: requestId,
        displayName: '张雨',
        email: 'user@example.test',
        emailVerified: true,
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
      session: {
        id: requestId,
        client: 'web',
        userAgent: null,
        createdAt: '2026-11-11T00:00:00.000Z',
        lastSeenAt: '2026-11-11T00:00:00.000Z',
        expiresAt: '2026-12-11T00:00:00.000Z',
        revokedAt: null,
        current: true,
      },
    };
    expect(AuthResponseSchema.safeParse({ ...base, csrfToken: 'token' }).success).toBe(true);
    expect(AuthResponseSchema.safeParse({ ...base, sessionToken: 'token' }).success).toBe(true);
    expect(AuthResponseSchema.safeParse({ ...base, secret: 'token' }).success).toBe(false);
  });
  it('requires at least one valid profile field', () => {
    expect(UpdateProfileRequestSchema.parse({ displayName: '张雨' }).displayName).toBe('张雨');
    expect(UpdateProfileRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateProfileRequestSchema.safeParse({ timezone: 'Not/A_Timezone' }).success).toBe(
      false,
    );
    expect(
      UpdateProfileRequestSchema.safeParse({ locale: 'zh-CN', timezone: 'Asia/Shanghai' }).success,
    ).toBe(true);
  });
  it('requires explicit campus membership states', () => {
    expect(
      CampusMembershipSchema.safeParse({
        id: requestId,
        campusId: requestId,
        campusName: '西安交通大学（开发样例）',
        status: 'pending',
        verificationMethod: null,
        verifiedAt: null,
        createdAt: '2026-11-11T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      CampusMembershipSchema.safeParse({
        id: requestId,
        campusId: requestId,
        campusName: '西安交通大学（开发样例）',
        status: 'self_verified',
        verificationMethod: null,
        verifiedAt: null,
        createdAt: '2026-11-11T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
