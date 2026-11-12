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
  type McpServerConfigCreate,
  type McpServerListResponse,
  type McpServerRegisterResponse,
  type PluginCatalogResponse,
  type PluginCategory,
  type PluginInvokeRequest,
  type PluginInvokeResponse,
} from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';

export type PluginCallOptions = ConnectionCallOptions;

export type PluginsClient = ReturnType<typeof createPluginsClient>;

export function createPluginsClient(request: ApiRequest, invalidRequest: () => Error) {
  return {
    async listCatalog(
      options: PluginCallOptions & { category?: PluginCategory },
    ): Promise<PluginCatalogResponse> {
      let queryString = '';
      if (options.category !== undefined) {
        const parsedCategory = PluginCategorySchema.safeParse(options.category);
        if (!parsedCategory.success) throw invalidRequest();
        queryString = `?category=${encodeURIComponent(parsedCategory.data)}`;
      }
      const transport = authenticatedOptions(options, 'GET', invalidRequest);
      return request(
        `/api/v1/plugins${queryString}`,
        (value) => PluginCatalogResponseSchema.parse(value),
        transport,
      );
    },

    async invoke(
      pluginId: string,
      input: PluginInvokeRequest,
      options: PluginCallOptions,
    ): Promise<PluginInvokeResponse> {
      const parsedPluginId = PluginIdSchema.safeParse(pluginId);
      const parsedBody = PluginInvokeRequestSchema.safeParse(input);
      if (!parsedPluginId.success || !parsedBody.success) {
        throw invalidRequest();
      }
      const transport = authenticatedOptions(options, 'POST', invalidRequest);
      return request(
        `/api/v1/plugins/${encodeURIComponent(parsedPluginId.data)}/invoke`,
        (value) => PluginInvokeResponseSchema.parse(value),
        { ...transport, body: parsedBody.data },
      );
    },

    async listMcpServers(options: PluginCallOptions): Promise<McpServerListResponse> {
      const transport = authenticatedOptions(options, 'GET', invalidRequest);
      return request(
        '/api/v1/plugins/mcp/servers',
        (value) => McpServerListResponseSchema.parse(value),
        transport,
      );
    },

    async registerMcpServer(
      config: McpServerConfigCreate,
      options: PluginCallOptions,
    ): Promise<McpServerRegisterResponse> {
      const parsed = McpServerConfigCreateSchema.safeParse(config);
      if (!parsed.success) throw invalidRequest();
      const transport = authenticatedOptions(options, 'POST', invalidRequest);
      return request(
        '/api/v1/plugins/mcp/servers',
        (value) => McpServerRegisterResponseSchema.parse(value),
        { ...transport, body: parsed.data },
      );
    },

    async deleteMcpServer(serverId: string, options: PluginCallOptions): Promise<void> {
      const parsedId = RequestIdSchema.safeParse(serverId);
      if (!parsedId.success) throw invalidRequest();
      const transport = authenticatedOptions(options, 'DELETE', invalidRequest);
      await request(
        `/api/v1/plugins/mcp/servers/${encodeURIComponent(parsedId.data)}`,
        () => undefined,
        transport,
      );
    },
  };
}
