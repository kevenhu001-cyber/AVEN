import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ConsentPreviewSchema,
  CreateConsentPreviewRequestSchema,
  CreateReferralRequestSchema,
  ReferralDecisionRequestSchema,
  ReferralListResponseSchema,
  ReferralSchema,
  ReferralSharedSnapshotResponseSchema,
  RequestIdSchema,
  RevokeConsentRequestSchema,
  WithdrawReferralRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { ReferralService } from './referral.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ReferralController {
  constructor(@Inject(ReferralService) private readonly referrals: ReferralService) {}

  @Post('consents/previews')
  @HttpCode(201)
  async createPreview(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateConsentPreviewRequestSchema, body);
    return ConsentPreviewSchema.parse(await this.referrals.createPreview(auth, input));
  }

  @Post('referrals')
  @HttpCode(201)
  async createReferral(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateReferralRequestSchema, body);
    return ReferralSchema.parse(await this.referrals.createReferral(auth, input));
  }

  @Get('referrals/me')
  async listMine(@CurrentAuth() auth: AuthContext) {
    return ReferralListResponseSchema.parse({
      data: await this.referrals.listMine(auth),
    });
  }

  @Get('organizations/:id/referrals')
  async listOrganization(@CurrentAuth() auth: AuthContext, @Param('id') orgId: string) {
    return ReferralListResponseSchema.parse({
      data: await this.referrals.listOrganization(auth, parseId(orgId)),
    });
  }

  @Get('referrals/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return ReferralSchema.parse(await this.referrals.get(auth, parseId(id)));
  }

  @Get('referrals/:id/shared-snapshot')
  async getSharedSnapshot(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const refId = parseId(id);
    const snapshot = await this.referrals.getSharedSnapshot(auth, refId);
    return ReferralSharedSnapshotResponseSchema.parse({
      referralId: refId,
      snapshot,
    });
  }

  @Post('referrals/:id/decisions')
  @HttpCode(200)
  async decide(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(ReferralDecisionRequestSchema, body);
    return ReferralSchema.parse(await this.referrals.decide(auth, parseId(id), input));
  }

  @Post('referrals/:id/withdraw')
  @HttpCode(200)
  async withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(WithdrawReferralRequestSchema, body ?? {});
    return ReferralSchema.parse(await this.referrals.withdraw(auth, parseId(id), input));
  }

  @Post('consents/grants/:id/revoke')
  @HttpCode(200)
  async revokeConsent(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(RevokeConsentRequestSchema, body ?? {});
    const revoked = await this.referrals.revokeConsent(auth, parseId(id), input.reason);
    return { revoked };
  }
}
