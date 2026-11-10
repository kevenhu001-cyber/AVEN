import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LivenessResponseSchema } from '@aven/contracts';
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
  ready(): never {
    throw new ServiceNotReadyException();
  }
}
