import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  McpServerConfigCreateSchema,
  McpServerListResponseSchema,
  McpServerRegisterResponseSchema,
  PluginCatalogResponseSchema,
  PluginCategorySchema,
  PluginIdSchema,
  PluginInvokeRequestSchema,
  PluginInvokeResponseSchema,
  RequestIdSchema,
  type PluginCategory,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { parse } from '../http-validation.js';
import { PluginService } from './plugin.service.js';

@Controller('api/v1/plugins')
@UseGuards(AuthGuard)
export class PluginController {
  constructor(@Inject(PluginService) private readonly plugins: PluginService) {}

  @Get()
  listCatalog(@CurrentAuth() auth: AuthContext, @Query('category') categoryRaw?: string) {
    let category: PluginCategory | undefined;
    if (categoryRaw !== undefined && categoryRaw.trim() !== '') {
      const parsed = PluginCategorySchema.safeParse(categoryRaw.trim());
      if (!parsed.success) {
        throw new UnprocessableEntityException('Invalid plugin category.');
      }
      category = parsed.data;
    }
    return PluginCatalogResponseSchema.parse(this.plugins.listCatalog(auth, category));
  }

  @Get('mcp/servers')
  listMcpServers(@CurrentAuth() auth: AuthContext) {
    return McpServerListResponseSchema.parse(this.plugins.listMcpServers(auth));
  }

  @Post('mcp/servers')
  @HttpCode(201)
  async registerMcpServer(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    const config = parse(McpServerConfigCreateSchema, body);
    return McpServerRegisterResponseSchema.parse(
      await this.plugins.registerMcpServer(auth, config),
    );
  }

  @Delete('mcp/servers/:serverId')
  @HttpCode(204)
  unregisterMcpServer(@CurrentAuth() auth: AuthContext, @Param('serverId') serverIdRaw: string) {
    const serverId = RequestIdSchema.safeParse(serverIdRaw);
    if (!serverId.success) {
      throw new UnprocessableEntityException('Invalid MCP server identifier.');
    }
    this.plugins.unregisterMcpServer(auth, serverId.data);
  }

  @Post(':pluginId/invoke')
  @HttpCode(200)
  async invoke(
    @CurrentAuth() auth: AuthContext,
    @Param('pluginId') pluginIdRaw: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const pluginId = PluginIdSchema.safeParse(pluginIdRaw);
    if (!pluginId.success) {
      throw new UnprocessableEntityException('Invalid plugin identifier.');
    }
    const input = parse(PluginInvokeRequestSchema, body);
    const headerRequestId = RequestIdSchema.safeParse(request.header('x-request-id'));
    const result = await this.plugins.invoke(auth, pluginId.data, input, {
      ...(headerRequestId.success ? { requestId: headerRequestId.data } : {}),
    });
    return PluginInvokeResponseSchema.parse(result);
  }
}
