import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ActionCancelResponseSchema,
  ActionConfirmRequestSchema,
  ActionConfirmResponseSchema,
  ActionCreateRequestSchema,
  ActionCreateResponseSchema,
  ActionSchema,
  RequestIdSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { ActionService } from './action.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    throw new UnprocessableEntityException('Idempotency-Key is required.');
  }
  return key;
}

@Controller('api/v1/actions')
@UseGuards(AuthGuard)
export class ActionController {
  constructor(@Inject(ActionService) private readonly actions: ActionService) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(ActionCreateRequestSchema, body);
    return ActionCreateResponseSchema.parse(await this.actions.create(auth, input));
  }

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return ActionSchema.parse(await this.actions.get(auth, parseId(id)));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parse(ActionConfirmRequestSchema, body);
    return ActionConfirmResponseSchema.parse(
      await this.actions.confirm(auth, parseId(id), input, requireIdempotencyKey(idempotencyKey)),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return ActionCancelResponseSchema.parse(
      await this.actions.cancel(auth, parseId(id), requireIdempotencyKey(idempotencyKey)),
    );
  }
}
