import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  CancelEventRequestSchema,
  CreateEventDraftRequestSchema,
  EventListResponseSchema,
  EventSchema,
  EventStatusSchema,
  ProposeEventTimeRequestSchema,
  RequestIdSchema,
  RespondEventParticipantRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { EventService } from './event.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

@Controller('api/v1/events')
@UseGuards(AuthGuard)
export class EventController {
  constructor(@Inject(EventService) private readonly events: EventService) {}

  @Post()
  @HttpCode(201)
  async createDraft(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateEventDraftRequestSchema, body);
    return EventSchema.parse(await this.events.createDraft(auth, input));
  }

  @Get('me')
  async listMine(@CurrentAuth() auth: AuthContext, @Query('status') status?: string) {
    const parsedStatus = status ? parse(EventStatusSchema, status) : undefined;
    const items = await this.events.listMine(auth, parsedStatus);
    return EventListResponseSchema.parse({ data: items });
  }

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return EventSchema.parse(await this.events.get(auth, parseId(id)));
  }

  @Post(':id/proposals')
  @HttpCode(200)
  async proposeTime(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(ProposeEventTimeRequestSchema, body);
    return EventSchema.parse(await this.events.proposeTime(auth, parseId(id), input));
  }

  @Post(':id/responses')
  @HttpCode(200)
  async respond(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(RespondEventParticipantRequestSchema, body);
    return EventSchema.parse(await this.events.respond(auth, parseId(id), input));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(CancelEventRequestSchema, body ?? {});
    return EventSchema.parse(await this.events.cancel(auth, parseId(id), input));
  }
}
