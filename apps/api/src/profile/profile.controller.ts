import { Body, Controller, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CampusListResponseSchema,
  CampusMembershipListResponseSchema,
  CampusMembershipSchema,
  MeResponseSchema,
  RequestCampusMembershipSchema,
  UpdateProfileRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { ProfileService } from './profile.service.js';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profile: ProfileService) {}

  @Patch('me')
  async updateProfile(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(UpdateProfileRequestSchema, body);
    return MeResponseSchema.parse(await this.profile.updateProfile(auth, input));
  }

  @Get('campuses')
  async campuses() {
    return CampusListResponseSchema.parse(await this.profile.listCampuses());
  }

  @Get('me/campus-memberships')
  async memberships(@CurrentAuth() auth: AuthContext) {
    return CampusMembershipListResponseSchema.parse(await this.profile.listMemberships(auth));
  }

  @Post('me/campus-memberships')
  @HttpCode(200)
  async requestMembership(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(RequestCampusMembershipSchema, body);
    return CampusMembershipSchema.parse(await this.profile.requestMembership(auth, input.campusId));
  }
}
