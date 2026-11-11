import {
  Body,
  Controller,
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
  CreateIntentRequestSchema,
  GenerateMatchesRequestSchema,
  IntentListResponseSchema,
  IntentSchema,
  MatchCandidateListResponseSchema,
  RequestIdSchema,
  SetIntentStatusRequestSchema,
  UpdateIntentRequestSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { IntentService } from './intent.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

@Controller('api/v1')
@UseGuards(AuthGuard)
export class IntentController {
  constructor(@Inject(IntentService) private readonly intents: IntentService) {}

  @Post('intents')
  @HttpCode(201)
  async create(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateIntentRequestSchema, body);
    return IntentSchema.parse(await this.intents.create(auth, input));
  }

  @Get('intents/me')
  async listMine(@CurrentAuth() auth: AuthContext) {
    return IntentListResponseSchema.parse({
      data: await this.intents.listMine(auth),
    });
  }

  @Get('intents/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return IntentSchema.parse(await this.intents.get(auth, parseId(id)));
  }

  @Patch('intents/:id')
  @HttpCode(200)
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(UpdateIntentRequestSchema, body);
    return IntentSchema.parse(await this.intents.update(auth, parseId(id), input));
  }

  @Post('intents/:id/status')
  @HttpCode(200)
  async setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(SetIntentStatusRequestSchema, body);
    return IntentSchema.parse(await this.intents.setStatus(auth, parseId(id), input));
  }

  @Post('intents/:id/matches/generate')
  @HttpCode(200)
  async generateMatches(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(GenerateMatchesRequestSchema, body ?? {});
    const generatedCount = await this.intents.generateMatches(auth, parseId(id), input);
    return { generatedCount };
  }

  @Get('intents/:id/matches')
  async listMatches(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return MatchCandidateListResponseSchema.parse({
      data: await this.intents.listMatches(auth, parseId(id)),
    });
  }

  @Post('matches/:id/dismiss')
  @HttpCode(200)
  async dismissMatch(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const dismissed = await this.intents.dismissMatch(auth, parseId(id));
    return { dismissed };
  }
}
