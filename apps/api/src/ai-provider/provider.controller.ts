import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Put,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { UserAIProviderInputSchema, RequestIdSchema } from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { UserAIProviderService } from './provider.service.js';

@Controller('api/v1/agent/provider')
@UseGuards(AuthGuard)
export class UserAIProviderController {
  constructor(@Inject(UserAIProviderService) private readonly service: UserAIProviderService) {}
  @Get() async get(@CurrentAuth() auth: AuthContext) {
    return { data: await this.service.get(auth) };
  }
  @Put() async save(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    return { data: await this.service.save(auth, parse(UserAIProviderInputSchema, body)) };
  }
  @Post('test') async test(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    return this.service.test(auth, parse(UserAIProviderInputSchema, body));
  }
  @Delete() async delete(
    @CurrentAuth() auth: AuthContext,
    @Query('version') rawVersion?: string,
    @Query('configId') configId?: string,
  ) {
    if (!rawVersion || !/^[1-9]\d{0,9}$/.test(rawVersion) || Number(rawVersion) > 2147483647)
      throw new UnprocessableEntityException('Invalid version.');
    return {
      deleted: await this.service.delete(
        auth,
        Number(rawVersion),
        parse(RequestIdSchema, configId),
      ),
    };
  }
}
