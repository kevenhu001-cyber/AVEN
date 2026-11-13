import { Body, Controller, Get, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { AdminConfigInputSchema, AdminConfigKindSchema } from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import type { AuthContext } from '../auth/auth.types.js';
import { parse } from '../http-validation.js';
import { AdminService } from './admin.service.js';
@Controller('api/v1/admin/configurations')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly service: AdminService) {}
  @Get() async list(@CurrentAuth() auth: AuthContext) {
    return {
      data: await this.service.list(auth),
      connectorEnvironmentConfigured: Boolean(process.env.OOMOL_PROJECT_API_KEY?.trim()),
    };
  }
  @Put(':kind') async save(
    @CurrentAuth() auth: AuthContext,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    return this.service.save(
      auth,
      parse(AdminConfigKindSchema, kind),
      parse(AdminConfigInputSchema, body),
    );
  }
}
