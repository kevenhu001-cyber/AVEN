import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  NotificationDeadListSchema,
  NotificationListQuerySchema,
  NotificationListSchema,
  NotificationPreferencesSchema,
  NotificationRetryResultSchema,
  NotificationSchema,
  RequestIdSchema,
  RetryNotificationSchema,
  UpdateNotificationPreferencesSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import type { AuthContext } from '../auth/auth.types.js';
import { parse } from '../http-validation.js';
import { NotificationService } from './notification.service.js';

@Controller('api/v1/notifications')
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly service: NotificationService) {}
  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() query: unknown) {
    const q = parse(NotificationListQuerySchema, query);
    return NotificationListSchema.parse(
      await this.service.list(auth, q.limit, q.cursorCreatedAt ?? null, q.cursorId ?? null),
    );
  }
  @Get('preferences')
  async preferences(@CurrentAuth() auth: AuthContext) {
    return NotificationPreferencesSchema.parse(await this.service.preferences(auth));
  }
  @Post('preferences')
  @HttpCode(200)
  async updatePreferences(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(UpdateNotificationPreferencesSchema, body);
    return NotificationPreferencesSchema.parse(await this.service.updatePreferences(auth, input));
  }
  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return NotificationSchema.parse(await this.service.read(auth, parse(RequestIdSchema, id)));
  }
  @Get('deliveries/dead')
  async dead(@CurrentAuth() auth: AuthContext) {
    return NotificationDeadListSchema.parse({
      data: await this.service.dead(auth),
    });
  }
  @Post('deliveries/:id/retry')
  @HttpCode(200)
  async retry(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(RetryNotificationSchema, body);
    return NotificationRetryResultSchema.parse(
      await this.service.retry(auth, parse(RequestIdSchema, id), input.expectedGeneration),
    );
  }
}
