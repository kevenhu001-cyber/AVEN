import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ConnectionDecisionRequestSchema,
  ConnectionInvitationListSchema,
  ConnectionInvitationSchema,
  ConnectionPreviewSchema,
  ConnectionSnapshotSchema,
  ConnectionWithdrawRequestSchema,
  ConnectionWidgetSchema,
  CreateConnectionPreviewRequestSchema,
  PeerConnectionListSchema,
  RequestIdSchema,
  SendConnectionInvitationRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { ConnectionService } from './connection.service.js';

@Controller('api/v1/connections')
@UseGuards(AuthGuard)
export class ConnectionController {
  constructor(@Inject(ConnectionService) private readonly connections: ConnectionService) {}
  @Post('previews')
  async preview(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    return ConnectionPreviewSchema.parse(
      await this.connections.preview(auth, parse(CreateConnectionPreviewRequestSchema, body)),
    );
  }
  @Post('invitations')
  async send(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    const input = parse(SendConnectionInvitationRequestSchema, body);
    return ConnectionInvitationSchema.parse(
      await this.connections.send(auth, input.previewId, parse(RequestIdSchema, key)),
    );
  }
  @Get('invitations')
  async list(@CurrentAuth() auth: AuthContext) {
    return ConnectionInvitationListSchema.parse({ data: await this.connections.list(auth) });
  }
  @Get()
  async listConnections(@CurrentAuth() auth: AuthContext) {
    return PeerConnectionListSchema.parse({ data: await this.connections.connections(auth) });
  }
  @Get('invitations/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return ConnectionInvitationSchema.parse(
      await this.connections.get(auth, parse(RequestIdSchema, id)),
    );
  }
  @Get('invitations/:id/snapshot')
  async snapshot(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const invitationId = parse(RequestIdSchema, id);
    return ConnectionSnapshotSchema.parse({
      invitationId,
      items: await this.connections.snapshot(auth, invitationId),
    });
  }
  @Get('invitations/:id/widget')
  async widget(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return ConnectionWidgetSchema.parse(
      await this.connections.widget(auth, parse(RequestIdSchema, id)),
    );
  }
  @Post('invitations/:id/decision')
  @HttpCode(200)
  async decide(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(ConnectionDecisionRequestSchema, body);
    return ConnectionInvitationSchema.parse(
      await this.connections.decide(
        auth,
        parse(RequestIdSchema, id),
        input.decision,
        input.expectedVersion,
      ),
    );
  }
  @Post('invitations/:id/withdraw')
  @HttpCode(200)
  async withdraw(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(ConnectionWithdrawRequestSchema, body);
    return ConnectionInvitationSchema.parse(
      await this.connections.revoke(auth, parse(RequestIdSchema, id), true, input.expectedVersion),
    );
  }
  @Post('invitations/:id/revoke')
  @HttpCode(200)
  async revoke(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return ConnectionInvitationSchema.parse(
      await this.connections.revoke(auth, parse(RequestIdSchema, id), false, null),
    );
  }
}
