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
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ConfirmMemoryRequestSchema,
  ContextUseSchema,
  CreateMemoryRequestSchema,
  ExtractMemoryRequestSchema,
  ExtractMemoryResponseSchema,
  MemoryCandidateListResponseSchema,
  MemoryDetailSchema,
  MemoryEventListResponseSchema,
  MemoryKindSchema,
  MemoryListResponseSchema,
  RejectMemoryRequestSchema,
  RequestIdSchema,
  UpdateMemoryRequestSchema,
  type ContextUse,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { MemoryService } from './memory.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 20;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new UnprocessableEntityException('Invalid limit.');
  }
  return limit;
}

function parseUse(value: string | undefined): ContextUse {
  const parsed = ContextUseSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid memory use.');
  return parsed.data;
}

@Controller('api/v1/memories')
@UseGuards(AuthGuard)
export class MemoryController {
  constructor(@Inject(MemoryService) private readonly memories: MemoryService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('kind') kind: string | undefined,
  ) {
    const parsedKind = kind === undefined ? undefined : MemoryKindSchema.safeParse(kind);
    if (parsedKind && !parsedKind.success) {
      throw new UnprocessableEntityException('Invalid memory kind.');
    }
    return MemoryListResponseSchema.parse(
      await this.memories.list(auth, {
        limit: parseLimit(limit),
        ...(cursor ? { cursor } : {}),
        ...(parsedKind?.success ? { kind: parsedKind.data } : {}),
      }),
    );
  }

  @Get('candidates')
  async listCandidates(
    @CurrentAuth() auth: AuthContext,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    return MemoryCandidateListResponseSchema.parse(
      await this.memories.listCandidates(auth, {
        limit: parseLimit(limit),
        ...(cursor ? { cursor } : {}),
      }),
    );
  }

  @Get('usable')
  async listUsable(
    @CurrentAuth() auth: AuthContext,
    @Query('use') use: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    return MemoryListResponseSchema.parse(
      await this.memories.listUsable(auth, parseUse(use), {
        limit: parseLimit(limit),
        ...(cursor ? { cursor } : {}),
      }),
    );
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateMemoryRequestSchema, body);
    return MemoryDetailSchema.parse(await this.memories.create(auth, input));
  }

  @Post('extract')
  @HttpCode(201)
  async extract(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(ExtractMemoryRequestSchema, body);
    return ExtractMemoryResponseSchema.parse(await this.memories.extract(auth, input));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(ConfirmMemoryRequestSchema, body);
    return MemoryDetailSchema.parse(await this.memories.confirm(auth, parseId(id), input));
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(RejectMemoryRequestSchema, body);
    return MemoryDetailSchema.parse(await this.memories.reject(auth, parseId(id), input));
  }

  @Get(':id/events')
  async listEvents(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    return MemoryEventListResponseSchema.parse(
      await this.memories.listEvents(auth, parseId(id), {
        limit: parseLimit(limit),
        ...(cursor ? { cursor } : {}),
      }),
    );
  }

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return MemoryDetailSchema.parse(await this.memories.get(auth, parseId(id)));
  }

  @Patch(':id')
  async update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(UpdateMemoryRequestSchema, body);
    return MemoryDetailSchema.parse(await this.memories.update(auth, parseId(id), input));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query('expectedVersion') expectedVersion: string | undefined,
  ): Promise<void> {
    const version = Number(expectedVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new UnprocessableEntityException('expectedVersion is required.');
    }
    await this.memories.delete(auth, parseId(id), version);
  }
}
