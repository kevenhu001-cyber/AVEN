import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  AcceptOrganizationInvitationRequestSchema,
  AcceptOrganizationInvitationResponseSchema,
  CreateOrganizationRequestSchema,
  InviteOrganizationMemberRequestSchema,
  OrganizationDetailSchema,
  OrganizationInvitationListResponseSchema,
  OrganizationInvitationSchema,
  OrganizationListResponseSchema,
  OrganizationMemberListResponseSchema,
  RequestIdSchema,
  UpdateOrganizationMemberRoleRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { OrganizationService } from './organization.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

@Controller('api/v1')
@UseGuards(AuthGuard)
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly organizations: OrganizationService) {}

  @Post('organizations')
  @HttpCode(201)
  async create(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateOrganizationRequestSchema, body);
    return OrganizationDetailSchema.parse(await this.organizations.create(auth, input));
  }

  @Get('organizations')
  async list(@CurrentAuth() auth: AuthContext) {
    return OrganizationListResponseSchema.parse(await this.organizations.list(auth));
  }

  @Get('organizations/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return OrganizationDetailSchema.parse(await this.organizations.get(auth, parseId(id)));
  }

  @Get('organizations/:id/members')
  async members(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return OrganizationMemberListResponseSchema.parse(
      await this.organizations.members(auth, parseId(id)),
    );
  }

  @Post('organizations/:id/invitations')
  @HttpCode(201)
  async invite(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(InviteOrganizationMemberRequestSchema, body);
    return OrganizationInvitationSchema.parse(
      await this.organizations.invite(auth, parseId(id), input),
    );
  }

  @Get('organizations/:id/invitations')
  async invitations(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return OrganizationInvitationListResponseSchema.parse(
      await this.organizations.invitations(auth, parseId(id)),
    );
  }

  @Post('organization-invitations/accept')
  @HttpCode(200)
  async acceptInvitation(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(AcceptOrganizationInvitationRequestSchema, body);
    return AcceptOrganizationInvitationResponseSchema.parse(
      await this.organizations.acceptInvitation(auth, input.token),
    );
  }

  @Patch('organizations/:id/members/:userId')
  @HttpCode(204)
  async updateRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const input = parse(UpdateOrganizationMemberRoleRequestSchema, body);
    await this.organizations.updateRole(auth, parseId(id), parseId(userId), input.role);
  }

  @Delete('organizations/:id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.organizations.removeMember(auth, parseId(id), parseId(userId));
  }

  @Post('organizations/:id/leave')
  @HttpCode(204)
  async leave(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.organizations.leave(auth, parseId(id));
  }
}
