import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { z } from 'zod';
import {
  McpDiscoveredToolSchema,
  McpServerConfigCreateSchema,
  McpServerListResponseSchema,
  McpServerRegisterResponseSchema,
  McpServerSummarySchema,
  SafeHttpsUrlSchema,
  TOOL_PERMISSIONS,
  type McpDiscoveredTool,
  type McpResultWidget,
  type McpServerConfigCreate,
  type McpServerListResponse,
  type McpServerRegisterResponse,
  type McpServerSummary,
  type PluginManifest,
} from '@aven/contracts';
import { AIError } from '../errors.js';
import type { PluginActionHandler, PluginConnector, PluginRegistry } from './registry.js';

export type RegisteredMcpServerRecord = {
  ownerUserId: string;
  serverId: string;
  pluginId: string;
  name: string;
  endpointUrl: string;
  authType: 'none' | 'bearer' | 'api_key_header';
  headerName?: string;
  hasCredential: boolean;
  timeoutMs: number;
  readOnlyDefault: boolean;
  status: 'connected_mock' | 'connected_live';
  discoveredTools: McpDiscoveredTool[];
  createdAt: string;
};

export type McpToolCallResult = {
  summaryText: string;
  rows: Array<{ label: string; value: string }>;
  rawData?: Record<string, unknown>;
};

export type McpTransportAdapter = {
  discoverTools: (
    config: McpServerConfigCreate,
    signal?: AbortSignal,
  ) => Promise<readonly McpDiscoveredTool[]>;
  callTool: (
    server: RegisteredMcpServerRecord,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<McpToolCallResult>;
};

const McpGenericInputSchema = z.record(z.string(), z.unknown());
const McpGenericOutputSchema = z.record(z.string(), z.unknown());

function normalizeActionName(toolName: string): string {
  const normalized = toolName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 48);
  return normalized.length >= 2 ? normalized : 'run_tool';
}

function defaultMockDiscovery(config: McpServerConfigCreate): McpDiscoveredTool[] {
  return [
    {
      name: 'query_resource',
      title: `${config.name} 资源检索`,
      description: `向自定义 MCP 服务 ${config.name} 执行结构化只读查询（标准受控模式）。`,
      readOnly: config.readOnlyDefault,
      inputJsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或指令' },
        },
        required: ['query'],
      },
    },
  ];
}

function defaultMockCall(
  server: RegisteredMcpServerRecord,
  toolName: string,
  args: Record<string, unknown>,
): McpToolCallResult {
  const entries = Object.entries(args).slice(0, 12);
  const rows = [
    { label: 'MCP 服务', value: server.name },
    { label: '调用工具', value: toolName },
    ...entries.map(([key, val]) => ({
      label: key,
      value: typeof val === 'string' ? val.slice(0, 200) : JSON.stringify(val).slice(0, 200),
    })),
  ];
  return {
    summaryText: `已完成自定义 MCP「${server.name}」工具 ${toolName} 的安全沙箱受控调用。`,
    rows,
    rawData: { serverId: server.serverId, toolName, args },
  };
}

export class McpPluginManager {
  private readonly servers = new Map<string, RegisteredMcpServerRecord>();

  constructor(
    private readonly registry: PluginRegistry,
    private readonly adapter?: McpTransportAdapter,
  ) {}

  async registerServer(
    ownerUserId: string,
    rawConfig: McpServerConfigCreate,
    signal?: AbortSignal,
  ): Promise<McpServerRegisterResponse> {
    const parsedConfig = McpServerConfigCreateSchema.safeParse(rawConfig);
    if (!parsedConfig.success) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Invalid MCP server configuration.');
    }
    const config = parsedConfig.data;

    // Enforce SSRF validation explicitly before any discovery call
    const endpointCheck = SafeHttpsUrlSchema.safeParse(config.endpointUrl);
    if (!endpointCheck.success) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Unsafe or non-HTTPS MCP endpoint URL.');
    }
    const endpointHost = new URL(endpointCheck.data).hostname;

    const rawTools = this.adapter
      ? await this.adapter.discoverTools(config, signal)
      : defaultMockDiscovery(config);
    const parsedTools = rawTools.map((tool) => McpDiscoveredToolSchema.parse(tool));
    const allowSet = config.allowedTools ? new Set(config.allowedTools) : null;
    const filteredTools = allowSet
      ? parsedTools.filter((tool) => allowSet.has(tool.name))
      : parsedTools;

    if (filteredTools.length === 0) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'No allowed tools discovered from MCP server.');
    }

    const serverId = randomUUID();
    const pluginId = `mcp.srv_${serverId.slice(0, 8)}`;
    const status = this.adapter ? 'connected_live' : 'connected_mock';
    const record: RegisteredMcpServerRecord = {
      ownerUserId,
      serverId,
      pluginId,
      name: config.name,
      endpointUrl: endpointCheck.data,
      authType: config.authType,
      ...(config.headerName ? { headerName: config.headerName } : {}),
      hasCredential: Boolean(config.credentialSecret?.trim()),
      timeoutMs: config.timeoutMs,
      readOnlyDefault: config.readOnlyDefault,
      status,
      discoveredTools: filteredTools,
      createdAt: new Date().toISOString(),
    };

    const connector = this.buildConnectorForRecord(record, endpointHost);
    this.registry.register(connector);
    this.servers.set(serverId, record);

    const manifest: PluginManifest = this.registry
      .listCatalog('mcp')
      .plugins.find((p) => p.id === pluginId)!;
    return McpServerRegisterResponseSchema.parse({
      server: this.toSummary(record),
      registeredPlugin: manifest,
    });
  }

  listServers(ownerUserId: string): McpServerListResponse {
    const owned = [...this.servers.values()]
      .filter((record) => record.ownerUserId === ownerUserId)
      .map((record) => this.toSummary(record));
    return McpServerListResponseSchema.parse({
      servers: owned,
      total: owned.length,
    });
  }

  unregisterServer(ownerUserId: string, serverId: string): void {
    const record = this.servers.get(serverId);
    if (!record || record.ownerUserId !== ownerUserId) {
      throw new AIError('TOOL_NOT_FOUND', 'MCP server was not found.');
    }
    this.registry.unregister(record.pluginId);
    this.servers.delete(serverId);
  }

  canUserAccessPlugin(ownerUserId: string, pluginId: string): boolean {
    if (!pluginId.startsWith('mcp.')) return true;
    for (const record of this.servers.values()) {
      if (record.pluginId === pluginId) {
        return record.ownerUserId === ownerUserId;
      }
    }
    return false;
  }

  private toSummary(record: RegisteredMcpServerRecord): McpServerSummary {
    return McpServerSummarySchema.parse({
      serverId: record.serverId,
      pluginId: record.pluginId,
      name: record.name,
      endpointUrl: record.endpointUrl,
      authType: record.authType,
      hasCredential: record.hasCredential,
      timeoutMs: record.timeoutMs,
      status: record.status,
      discoveredTools: record.discoveredTools,
      createdAt: record.createdAt,
    });
  }

  private buildConnectorForRecord(
    record: RegisteredMcpServerRecord,
    endpointHost: string,
  ): PluginConnector {
    const seenActions = new Set<string>();
    const actions: PluginActionHandler<Record<string, unknown>, Record<string, unknown>>[] = [];

    for (const tool of record.discoveredTools) {
      let actionName = normalizeActionName(tool.name);
      while (seenActions.has(actionName)) {
        actionName = `${actionName.slice(0, 42)}_${seenActions.size}`;
      }
      seenActions.add(actionName);

      const handler: PluginActionHandler<Record<string, unknown>, Record<string, unknown>> = {
        name: actionName,
        title: tool.title,
        description: tool.description,
        inputSchema: McpGenericInputSchema,
        outputSchema: McpGenericOutputSchema,
        requiredPermissions: [TOOL_PERMISSIONS.pluginInvokeMcp],
        widgetKinds: ['mcp_result_card'],
        timeoutMs: record.timeoutMs,
        maxRetries: 0,
        idempotent: tool.readOnly,
        execute: async (input, context) => {
          const useLive = this.adapter !== undefined;
          const result = useLive
            ? await this.adapter!.callTool(record, tool.name, input, context.signal)
            : defaultMockCall(record, tool.name, input);
          const providerMode = useLive ? 'live' : 'mock';
          const widget: McpResultWidget = {
            widgetId: `${context.widgetIdPrefix}-${actionName}`,
            kind: 'mcp_result_card',
            pluginId: record.pluginId,
            title: `${record.name} · ${tool.title}`,
            serverId: record.serverId,
            serverName: record.name,
            toolName: tool.name,
            displayMode: result.rows.length > 0 ? 'key_value' : 'summary',
            summaryText: result.summaryText.slice(0, 1000),
            rows: result.rows.slice(0, 25),
            readOnly: tool.readOnly,
            externalNotice: '来自用户自定义 MCP 服务的结构化只读结果，未执行外部脚本。',
            providerMode,
          };
          return {
            providerMode,
            summary: result.summaryText.slice(0, 500),
            data: result.rawData ?? { summary: result.summaryText, rows: result.rows },
            widgets: [widget],
          };
        },
      };

      actions.push(handler);
    }

    return {
      id: record.pluginId,
      name: `${record.name} (MCP)`,
      providerName: `自定义 MCP（${endpointHost}）`,
      description: `用户挂载的自定义 MCP 插件：${record.name}`,
      version: '1.0.0',
      category: 'mcp',
      authType:
        record.authType === 'none' ? 'none' : record.authType === 'bearer' ? 'oauth2' : 'api_key',
      allowedExternalHosts: [endpointHost],
      supportsLiveAdapter: this.adapter !== undefined,
      readOnly: record.readOnlyDefault,
      hasLiveCredentials: () => this.adapter !== undefined,
      actions: actions as PluginActionHandler<unknown, Record<string, unknown>>[],
    };
  }
}
