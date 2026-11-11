import { randomUUID } from 'node:crypto';
import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ApiErrorResponseSchema, RequestIdSchema } from '@aven/contracts';
import type { ApiErrorCode, ApiErrorResponse } from '@aven/contracts';
import type { Response } from 'express';

export class ServiceNotReadyException extends HttpException {
  constructor(
    message = 'Foundation dependencies are not configured.',
    public readonly retryable = false,
  ) {
    super(message, 503);
  }
}

export class RateLimitedException extends HttpException {
  constructor(public readonly retryAfter: number) {
    super('Too many requests.', 429);
  }
}

export class ApiCodeException extends HttpException {
  constructor(
    public readonly code: ApiErrorCode,
    status: number,
    message: string,
    public readonly retryable = false,
  ) {
    super(message, status);
  }
}

export function responseRequestId(response: Response): string {
  const id = RequestIdSchema.safeParse(response.getHeader('X-Request-Id'));
  return id.success ? id.data : randomUUID();
}

export function formatException(
  error: unknown,
  requestId: string,
): { status: number; body: ApiErrorResponse } {
  let status = error instanceof HttpException ? error.getStatus() : 500;
  let code: ApiErrorCode = 'INTERNAL';
  let message = 'The service could not complete this request.';
  let retryable = false;
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const dependencyCodes = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    '08000',
    '08001',
    '08006',
    '57P01',
    '57P02',
    '57P03',
  ]);
  const databaseErrors: Record<string, { status: number; code: ApiErrorCode; message: string }> = {
    '28000': { status: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
    '42501': { status: 403, code: 'FORBIDDEN', message: 'Access is not allowed.' },
    '23505': {
      status: 409,
      code: 'CONFLICT',
      message: 'The request conflicts with the current state.',
    },
    '23514': {
      status: 409,
      code: 'CONFLICT',
      message: 'The request conflicts with the current state.',
    },
    '22023': { status: 422, code: 'VALIDATION_ERROR', message: 'The request is invalid.' },
    P0002: { status: 404, code: 'NOT_FOUND', message: 'Resource not found.' },
    P0003: {
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'The idempotency key was reused with a different request.',
    },
  };
  if (error instanceof ApiCodeException) {
    code = error.code;
    message = error.message;
    retryable = error.retryable;
  } else if (error instanceof ServiceNotReadyException) {
    code = 'SERVICE_NOT_READY';
    message = 'Foundation dependencies and consumers are not configured.';
    retryable = error.retryable;
  } else if (databaseErrors[errorCode]) {
    const mapped = databaseErrors[errorCode];
    status = mapped.status;
    code = mapped.code;
    message = mapped.message;
  } else if (dependencyCodes.has(errorCode)) {
    status = 503;
    code = 'SERVICE_NOT_READY';
    message = 'A required dependency is unavailable.';
    retryable = true;
  } else if (status === 404) {
    code = 'NOT_FOUND';
    message = 'Resource not found.';
  } else if (status === 400 || status === 422) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'The request is invalid.';
  } else if (status === 401) {
    code = 'UNAUTHENTICATED';
    message = 'Authentication is required.';
  } else if (status === 403) {
    code = 'FORBIDDEN';
    message = 'Access is not allowed.';
  } else if (status === 409) {
    code = 'CONFLICT';
    message = 'The request conflicts with the current state.';
  } else if (status === 429) {
    code = 'RATE_LIMITED';
    message = 'Too many requests.';
    retryable = true;
  } else {
    status = 500;
  }
  return {
    status,
    body: ApiErrorResponseSchema.parse({
      error: { code, message, request_id: requestId, retryable },
    }),
  };
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = responseRequestId(response);
    const result = formatException(error, requestId);
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof RateLimitedException) {
      response.setHeader('Retry-After', String(error.retryAfter));
    }
    response.status(result.status).json(result.body);
  }
}
