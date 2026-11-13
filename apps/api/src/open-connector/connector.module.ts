import { Controller, Delete, Get, Inject, Module, Param, Post, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import type { AuthContext } from '../auth/auth.types.js';
import { parse } from '../http-validation.js';
import { ConnectorServiceSchema, OpenConnectorService } from './connector.service.js';
@Controller('api/v1/open-connector')
@UseGuards(AuthGuard)
class OpenConnectorController {
  constructor(@Inject(OpenConnectorService) private readonly service: OpenConnectorService) {}
  @Get() list(@CurrentAuth() auth: AuthContext) {
    return this.service.list(auth);
  }
  @Post(':service/connect') connect(
    @CurrentAuth() auth: AuthContext,
    @Param('service') service: string,
  ) {
    return this.service.connect(auth, parse(ConnectorServiceSchema, service));
  }
  @Post(':service/refresh') refresh(
    @CurrentAuth() auth: AuthContext,
    @Param('service') service: string,
  ) {
    return this.service.refresh(auth, parse(ConnectorServiceSchema, service));
  }
  @Delete(':service') disconnect(
    @CurrentAuth() auth: AuthContext,
    @Param('service') service: string,
  ) {
    return this.service.disconnect(auth, parse(ConnectorServiceSchema, service));
  }
}
@Module({
  imports: [AuthModule],
  controllers: [OpenConnectorController],
  providers: [OpenConnectorService],
})
export class OpenConnectorModule {}
