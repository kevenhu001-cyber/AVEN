import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  BlockUserRequestSchema,
  BlockUserResponseSchema,
  UnblockUserResponseSchema,
  ListBlocksResponseSchema,
  SubmitReportRequestSchema,
  SubmitReportResponseSchema,
  ListReportsResponseSchema,
  RequestIdSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { ModerationService } from './moderation.service.js';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ModerationController {
  constructor(@Inject(ModerationService) private readonly moderation: ModerationService) {}

  @Post('blocks')
  @HttpCode(201)
  async blockUser(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(BlockUserRequestSchema, body);
    return BlockUserResponseSchema.parse(await this.moderation.blockUser(auth, input));
  }

  @Delete('blocks/:id')
  async unblockUser(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const userId = parse(RequestIdSchema, id);
    return UnblockUserResponseSchema.parse(await this.moderation.unblockUser(auth, userId));
  }

  @Get('blocks')
  async listBlocks(@CurrentAuth() auth: AuthContext) {
    return ListBlocksResponseSchema.parse(await this.moderation.listBlocks(auth));
  }

  @Post('reports')
  @HttpCode(201)
  async submitReport(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(SubmitReportRequestSchema, body);
    return SubmitReportResponseSchema.parse(await this.moderation.submitReport(auth, input));
  }

  @Get('reports')
  async listReports(@CurrentAuth() auth: AuthContext) {
    return ListReportsResponseSchema.parse(await this.moderation.listReports(auth));
  }
}
