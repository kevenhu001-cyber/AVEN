import { UnprocessableEntityException } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from './auth/auth.types.js';

export type Parser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export function parse<T>(schema: Parser<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UnprocessableEntityException('Invalid request.');
  return result.data;
}

export function requestContext(request: Request): RequestContext {
  return {
    ip: request.ip ?? request.socket.remoteAddress ?? 'unknown',
    userAgent: request.header('user-agent') ?? '',
  };
}
