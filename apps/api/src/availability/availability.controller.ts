import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  AvailabilityBlockListResponseSchema,
  AvailabilityBlockSchema,
  AvailabilityShareListResponseSchema,
  AvailabilityShareSchema,
  AvailabilityWindowResponseSchema,
  CreateAvailabilityShareRequestSchema,
  QueryAvailabilityWindowRequestSchema,
  RequestIdSchema,
  TimeIntersectionRequestSchema,
  TimeIntersectionResponseSchema,
  UpsertAvailabilityBlockRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { AvailabilityService } from './availability.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

@Controller('api/v1/availability')
@UseGuards(AuthGuard)
export class AvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly availability: AvailabilityService) {}

  @Post('blocks')
  @HttpCode(200)
  async upsertBlock(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(UpsertAvailabilityBlockRequestSchema, body);
    return AvailabilityBlockSchema.parse(await this.availability.upsertBlock(auth, input));
  }

  @Delete('blocks/:id')
  @HttpCode(200)
  async deleteBlock(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const deleted = await this.availability.deleteBlock(auth, parseId(id));
    return { deleted };
  }

  @Get('me')
  async listMine(
    @CurrentAuth() auth: AuthContext,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
  ) {
    const now = new Date();
    const defaultStart = startAt ?? now.toISOString();
    const defaultEnd = endAt ?? new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();

    const blocks = await this.availability.listMine(auth, defaultStart, defaultEnd);
    return AvailabilityBlockListResponseSchema.parse({ data: blocks });
  }

  @Post('window')
  @HttpCode(200)
  async queryWindow(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(QueryAvailabilityWindowRequestSchema, body);
    const items = await this.availability.queryWindow(auth, input);
    return AvailabilityWindowResponseSchema.parse({ data: items });
  }

  @Post('shares')
  @HttpCode(200)
  async createShare(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateAvailabilityShareRequestSchema, body);
    const share = await this.availability.createShare(auth, input);
    return AvailabilityShareSchema.parse(share);
  }

  @Get('shares')
  async listShares(@CurrentAuth() auth: AuthContext) {
    const shares = await this.availability.listShares(auth);
    return AvailabilityShareListResponseSchema.parse({ data: shares });
  }

  @Delete('shares/:id')
  @HttpCode(200)
  async revokeShare(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const revoked = await this.availability.revokeShare(auth, parseId(id));
    return { revoked };
  }

  @Post('intersection')
  @HttpCode(200)
  async computeIntersection(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(TimeIntersectionRequestSchema, body);
    const availableSlots = await this.availability.computeIntersection(auth, input);
    return TimeIntersectionResponseSchema.parse({ availableSlots });
  }
}
