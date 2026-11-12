import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  McpServerListResponseSchema,
  McpServerRegisterResponseSchema,
  PluginCatalogResponseSchema,
  PluginInvokeResponseSchema,
  TOOL_PERMISSIONS,
  type McpServerConfigCreate,
  type McpServerListResponse,
  type McpServerRegisterResponse,
  type PluginCatalogResponse,
  type PluginCategory,
  type PluginInvokeRequest,
  type PluginInvokeResponse,
  type ToolPermission,
} from '@aven/contracts';
import {
  createDefaultPluginRegistry,
  InMemoryToolAuditSink,
  isAIError,
  McpPluginManager,
  type McpTransportAdapter,
  type PluginRegistry,
  type ToolActor,
  type ToolAuditSink,
} from '@aven/ai-core';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiCodeException } from '../http-errors.js';

export const PLUGIN_REGISTRY = Symbol('PLUGIN_REGISTRY');
export const PLUGIN_AUDIT_SINK = Symbol('PLUGIN_AUDIT_SINK');
export const MCP_TRANSPORT_ADAPTER = Symbol('MCP_TRANSPORT_ADAPTER');

const DEFAULT_USER_PLUGIN_PERMISSIONS: readonly ToolPermission[] = [
  TOOL_PERMISSIONS.pluginReadCatalog,
  TOOL_PERMISSIONS.pluginInvokeMaps,
  TOOL_PERMISSIONS.pluginInvokeCommerce,
  TOOL_PERMISSIONS.pluginInvokeCalendar,
  TOOL_PERMISSIONS.pluginReadMail,
  TOOL_PERMISSIONS.pluginWriteMailDraft,
  TOOL_PERMISSIONS.pluginSendMail,
  TOOL_PERMISSIONS.pluginInvokeLifestyle,
  TOOL_PERMISSIONS.pluginInvokeSocial,
  TOOL_PERMISSIONS.pluginManageMcp,
  TOOL_PERMISSIONS.pluginInvokeMcp,
];

function mapPluginError(error: unknown): never {
  if (isAIError(error)) {
    switch (error.code) {
      case 'TOOL_NOT_FOUND':
        throw new ApiCodeException('NOT_FOUND', 404, 'Plugin or action was not found.', false);
      case 'TOOL_VALIDATION_FAILED':
        throw new ApiCodeException('VALIDATION_ERROR', 422, 'Plugin input is invalid.', false);
      case 'TOOL_PERMISSION_DENIED':
      case 'TOOL_SCOPE_DENIED':
        throw new ApiCodeException('FORBIDDEN', 403, 'Plugin permission is denied.', false);
      case 'TOOL_TIMEOUT':
      case 'PROVIDER_TIMEOUT':
        throw new ApiCodeException('PROVIDER_TIMEOUT', 504, 'Plugin execution timed out.', true);
      case 'PROVIDER_RATE_LIMITED':
        throw new ApiCodeException('RATE_LIMITED', 429, 'Plugin provider rate limit hit.', true);
      case 'PROVIDER_NOT_CONFIGURED':
      case 'PROVIDER_UNAVAILABLE':
      case 'TOOL_RESULT_INVALID':
      case 'TOOL_EXECUTION_FAILED':
      case 'TOOL_AUDIT_FAILED':
      case 'TOOL_CANCELLED':
        throw new ApiCodeException(
          'PROVIDER_UNAVAILABLE',
          503,
          'Plugin provider could not complete the request.',
          error.retryable,
        );
      default:
        throw new ApiCodeException(
          'PROVIDER_UNAVAILABLE',
          503,
          'Plugin provider could not complete the request.',
          error.retryable,
        );
    }
  }
  throw error;
}

@Injectable()
export class PluginService {
  private readonly registry: PluginRegistry;
  private readonly auditSink: ToolAuditSink;
  private readonly mcpManager: McpPluginManager;

  constructor(
    @Optional() @Inject(PLUGIN_REGISTRY) registry?: PluginRegistry,
    @Optional() @Inject(PLUGIN_AUDIT_SINK) auditSink?: ToolAuditSink,
    @Optional() @Inject(MCP_TRANSPORT_ADAPTER) mcpAdapter?: McpTransportAdapter,
  ) {
    this.registry = registry ?? createDefaultPluginRegistry();
    this.auditSink = auditSink ?? new InMemoryToolAuditSink();
    this.mcpManager = new McpPluginManager(this.registry, mcpAdapter);
  }

  listCatalog(auth: AuthContext, category?: PluginCategory): PluginCatalogResponse {
    const raw = this.registry.listCatalog(category);
    const visiblePlugins = raw.plugins.filter((plugin) =>
      this.mcpManager.canUserAccessPlugin(auth.userId, plugin.id),
    );
    return PluginCatalogResponseSchema.parse({
      plugins: visiblePlugins,
      total: visiblePlugins.length,
    });
  }

  async invoke(
    auth: AuthContext,
    pluginId: string,
    request: PluginInvokeRequest,
    options: { requestId?: string; permissions?: readonly ToolPermission[] } = {},
  ): Promise<PluginInvokeResponse> {
    if (!this.mcpManager.canUserAccessPlugin(auth.userId, pluginId)) {
      throw new ApiCodeException('NOT_FOUND', 404, 'Plugin or action was not found.', false);
    }

    const actor: ToolActor = {
      principalId: auth.principalId,
      userId: auth.userId,
      permissions: new Set(options.permissions ?? DEFAULT_USER_PLUGIN_PERMISSIONS),
      allowedUses: new Set(['self_ai']),
    };
    const requestId = options.requestId ?? randomUUID();

    try {
      const response = await this.registry.invoke(pluginId, request, actor, requestId, {
        auditSink: this.auditSink,
      });
      return PluginInvokeResponseSchema.parse(response);
    } catch (error) {
      mapPluginError(error);
    }
  }

  listMcpServers(auth: AuthContext): McpServerListResponse {
    return McpServerListResponseSchema.parse(this.mcpManager.listServers(auth.userId));
  }

  async registerMcpServer(
    auth: AuthContext,
    config: McpServerConfigCreate,
    permissions: readonly ToolPermission[] = DEFAULT_USER_PLUGIN_PERMISSIONS,
  ): Promise<McpServerRegisterResponse> {
    if (!permissions.includes(TOOL_PERMISSIONS.pluginManageMcp)) {
      throw new ApiCodeException('FORBIDDEN', 403, 'MCP management permission is denied.', false);
    }
    try {
      const registered = await this.mcpManager.registerServer(auth.userId, config);
      return McpServerRegisterResponseSchema.parse(registered);
    } catch (error) {
      mapPluginError(error);
    }
  }

  unregisterMcpServer(
    auth: AuthContext,
    serverId: string,
    permissions: readonly ToolPermission[] = DEFAULT_USER_PLUGIN_PERMISSIONS,
  ): void {
    if (!permissions.includes(TOOL_PERMISSIONS.pluginManageMcp)) {
      throw new ApiCodeException('FORBIDDEN', 403, 'MCP management permission is denied.', false);
    }
    try {
      this.mcpManager.unregisterServer(auth.userId, serverId);
    } catch (error) {
      mapPluginError(error);
    }
  }
}
