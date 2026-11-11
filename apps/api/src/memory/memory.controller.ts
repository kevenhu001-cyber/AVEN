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
  CreateMemoryRequestSchema,
  MemoryDetailSchema,
  MemoryKindSchema,
  MemoryListResponseSchema,
  RequestIdSchema,
  UpdateMemoryRequestSchema,
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

  @Post()
  @HttpCode(201)
  async create(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateMemoryRequestSchema, body);
    return MemoryDetailSchema.parse(await this.memories.create(auth, input));
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
