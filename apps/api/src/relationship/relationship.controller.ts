import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  CloseRelationshipRequestSchema,
  EstablishRelationshipRequestSchema,
  RelationshipContextResponseSchema,
  RelationshipListResponseSchema,
  RelationshipSchema,
  RequestIdSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { RelationshipService } from './relationship.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

@Controller('api/v1')
@UseGuards(AuthGuard)
export class RelationshipController {
  constructor(@Inject(RelationshipService) private readonly relationships: RelationshipService) {}

  @Post('relationships')
  @HttpCode(201)
  async establish(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(EstablishRelationshipRequestSchema, body);
    return RelationshipSchema.parse(await this.relationships.establish(auth, input));
  }

  @Get('relationships/me')
  async listMine(@CurrentAuth() auth: AuthContext) {
    return RelationshipListResponseSchema.parse({
      data: await this.relationships.listMine(auth),
    });
  }

  @Get('organizations/:id/relationships')
  async listOrganization(@CurrentAuth() auth: AuthContext, @Param('id') orgId: string) {
    return RelationshipListResponseSchema.parse({
      data: await this.relationships.listOrganization(auth, parseId(orgId)),
    });
  }

  @Get('relationships/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return RelationshipSchema.parse(await this.relationships.get(auth, parseId(id)));
  }

  @Get('relationships/:id/context')
  async getSharedContext(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const relId = parseId(id);
    const sharedContext = await this.relationships.getSharedContext(auth, relId);
    return RelationshipContextResponseSchema.parse({
      relationshipId: relId,
      sharedContext,
    });
  }

  @Post('relationships/:id/close')
  @HttpCode(200)
  async close(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(CloseRelationshipRequestSchema, body ?? {});
    return RelationshipSchema.parse(await this.relationships.close(auth, parseId(id), input));
  }
}
