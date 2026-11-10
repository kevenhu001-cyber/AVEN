import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LivenessResponseSchema, ReadinessResponseSchema } from '@aven/contracts';
import { getReadinessRuntime } from '@aven/service-health';
import { responseRequestId, ServiceNotReadyException } from './http-errors';

@Controller('health')
export class HealthController {
  @Get('live')
  live(@Res({ passthrough: true }) response: Response) {
    return LivenessResponseSchema.parse({
      status: 'ok',
      service: 'api',
      stage: 'foundation',
      request_id: responseRequestId(response),
    });
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const result = await getReadinessRuntime().check();
    if (!result.ok) {
      throw new ServiceNotReadyException(
        'Database, Redis, migrations, or consumers are not ready.',
        result.retryable,
      );
    }
    return ReadinessResponseSchema.parse({
      status: 'ok',
      service: 'api',
      stage: 'foundation',
      checks: result.checks,
      request_id: responseRequestId(response),
    });
  }
}
