import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  CreateOpportunityDraftRequestSchema,
  OpportunityDetailSchema,
  OpportunityLifecycleActionRequestSchema,
  OpportunityListResponseSchema,
  OpportunityStageSchema,
  RequestIdSchema,
  UpdateOpportunityRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, OptionalAuth } from '../auth/current-auth.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { parse } from '../http-validation.js';
import { OpportunityService } from './opportunity.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

@Controller('api/v1')
@UseGuards(AuthGuard)
export class OpportunityController {
  constructor(@Inject(OpportunityService) private readonly opportunities: OpportunityService) {}

  @Post('organizations/:id/opportunities')
  @HttpCode(201)
  async createDraft(
    @CurrentAuth() auth: AuthContext,
    @Param('id') orgId: string,
    @Body() body: unknown,
  ) {
    const input = parse(CreateOpportunityDraftRequestSchema, body);
    return OpportunityDetailSchema.parse(
      await this.opportunities.createDraft(auth, parseId(orgId), input),
    );
  }

  @Get('organizations/:id/opportunities')
  async listOrganization(@CurrentAuth() auth: AuthContext, @Param('id') orgId: string) {
    return OpportunityListResponseSchema.parse(
      await this.opportunities.listOrganization(auth, parseId(orgId)),
    );
  }

  @Patch('organizations/:id/opportunities/:opportunityId')
  @HttpCode(200)
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') orgId: string,
    @Param('opportunityId') oppId: string,
    @Body() body: unknown,
  ) {
    const input = parse(UpdateOpportunityRequestSchema, body);
    return OpportunityDetailSchema.parse(
      await this.opportunities.update(auth, parseId(orgId), parseId(oppId), input),
    );
  }

  @Post('organizations/:id/opportunities/:opportunityId/publish')
  @HttpCode(200)
  async publish(
    @CurrentAuth() auth: AuthContext,
    @Param('id') orgId: string,
    @Param('opportunityId') oppId: string,
    @Body() body: unknown,
  ) {
    const input = parse(OpportunityLifecycleActionRequestSchema, body);
    return OpportunityDetailSchema.parse(
      await this.opportunities.publish(auth, parseId(orgId), parseId(oppId), input),
    );
  }

  @Post('organizations/:id/opportunities/:opportunityId/pause')
  @HttpCode(200)
  async pause(
    @CurrentAuth() auth: AuthContext,
    @Param('id') orgId: string,
    @Param('opportunityId') oppId: string,
    @Body() body: unknown,
  ) {
    const input = parse(OpportunityLifecycleActionRequestSchema, body);
    return OpportunityDetailSchema.parse(
      await this.opportunities.pause(auth, parseId(orgId), parseId(oppId), input),
    );
  }

  @Post('organizations/:id/opportunities/:opportunityId/close')
  @HttpCode(200)
  async close(
    @CurrentAuth() auth: AuthContext,
    @Param('id') orgId: string,
    @Param('opportunityId') oppId: string,
    @Body() body: unknown,
  ) {
    const input = parse(OpportunityLifecycleActionRequestSchema, body);
    return OpportunityDetailSchema.parse(
      await this.opportunities.close(auth, parseId(orgId), parseId(oppId), input),
    );
  }

  @Public()
  @Get('opportunities/:id')
  async get(@OptionalAuth() auth: AuthContext | undefined, @Param('id') id: string) {
    return OpportunityDetailSchema.parse(await this.opportunities.get(auth, parseId(id)));
  }

  @Public()
  @Get('opportunities')
  async listPublic(
    @OptionalAuth() auth: AuthContext | undefined,
    @Query('campusId') campusId?: string,
    @Query('stage') stage?: string,
    @Query('domain') domain?: string,
  ) {
    const parsedCampusId = campusId ? parseId(campusId) : undefined;
    const parsedStage = stage ? OpportunityStageSchema.parse(stage) : undefined;
    return OpportunityListResponseSchema.parse(
      await this.opportunities.listPublic(auth, {
        campusId: parsedCampusId,
        stage: parsedStage,
        domain: domain?.trim() || undefined,
      }),
    );
  }
}
