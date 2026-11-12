import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ConversationWidgetSchema,
  PluginActionNameSchema,
  PluginCatalogResponseSchema,
  PluginIdSchema,
  PluginInvokeResponseSchema,
  PluginManifestSchema,
  type ConversationWidget,
  type ConversationWidgetKind,
  type PluginAuthType,
  type PluginCatalogResponse,
  type PluginCategory,
  type PluginCredentialStatus,
  type PluginInvokeRequest,
  type PluginInvokeResponse,
  type PluginManifest,
  type PluginProviderMode,
  type ToolPermission,
} from '@aven/contracts';
import { AIError } from '../errors.js';
import { ToolExecutor } from '../tool-executor.js';
import {
  InMemoryToolAuditSink,
  ToolRegistry,
  type ToolActor,
  type ToolAuditSink,
  type ToolDefinition,
} from '../tools.js';

export type PluginActionContext = {
  actor: ToolActor;
  requestId: string;
  allowLive: boolean;
  widgetIdPrefix: string;
  signal?: AbortSignal;
};

export type PluginActionExecutionResult<TOutput extends Record<string, unknown>> = {
  providerMode: PluginProviderMode;
  summary: string;
  data: TOutput;
  widgets: ConversationWidget[];
};

export type PluginActionHandler<TInput, TOutput extends Record<string, unknown>> = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  requiredPermissions: readonly ToolPermission[];
  widgetKinds: readonly ConversationWidgetKind[];
  timeoutMs: number;
  maxRetries: number;
  idempotent: boolean;
  execute: (
    input: TInput,
    context: PluginActionContext,
  ) => Promise<PluginActionExecutionResult<TOutput>>;
};

export type PluginConnector = {
  id: string;
  name: string;
  providerName: string;
  description: string;
  version: string;
  category: PluginCategory;
  authType: PluginAuthType;
  allowedExternalHosts: readonly string[];
  supportsLiveAdapter: boolean;
  readOnly: boolean;
  hasLiveCredentials: () => boolean;
  actions: readonly PluginActionHandler<unknown, Record<string, unknown>>[];
};

export type PluginInvokeRuntimeOptions = {
  auditSink?: ToolAuditSink;
  now?: () => Date;
};

const PluginInternalToolOutputSchema = z
  .object({
    providerMode: z.enum(['mock', 'live']),
    summary: z.string().trim().min(1).max(500),
    data: z.record(z.string(), z.unknown()),
    widgets: z.array(ConversationWidgetSchema).max(10),
  })
  .strict();

function resolveCredentialStatus(connector: PluginConnector): PluginCredentialStatus {
  if (!connector.supportsLiveAdapter) {
    return 'mock_only';
  }
  if (connector.authType === 'none' || connector.hasLiveCredentials()) {
    return 'configured';
  }
  return 'missing_credentials';
}

export function buildPluginManifest(connector: PluginConnector): PluginManifest {
  const credentialStatus = resolveCredentialStatus(connector);
  return PluginManifestSchema.parse({
    id: connector.id,
    name: connector.name,
    providerName: connector.providerName,
    description: connector.description,
    version: connector.version,
    category: connector.category,
    authType: connector.authType,
    credentialStatus,
    allowedExternalHosts: [...connector.allowedExternalHosts],
    supportsLiveAdapter: connector.supportsLiveAdapter,
    readOnly: connector.readOnly,
    actions: connector.actions.map((action) => ({
      name: action.name,
      title: action.title,
      description: action.description,
      requiredPermissions: [...action.requiredPermissions],
      widgetKinds: [...action.widgetKinds],
      idempotent: action.idempotent,
      timeoutMs: action.timeoutMs,
      maxRetries: action.maxRetries,
      inputJsonSchema: z.toJSONSchema(action.inputSchema) as Record<string, unknown>,
    })),
  });
}

export function buildPluginToolName(pluginId: string, actionName: string): string {
  return `plugin.${pluginId}.${actionName}`;
}

export class PluginRegistry {
  private readonly connectors = new Map<string, PluginConnector>();
  private readonly manifests = new Map<string, PluginManifest>();

  register(connector: PluginConnector): void {
    if (!PluginIdSchema.safeParse(connector.id).success) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Plugin id is invalid.');
    }
    if (this.connectors.has(connector.id)) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Plugin id is already registered.');
    }
    const seenActions = new Set<string>();
    for (const action of connector.actions) {
      if (!PluginActionNameSchema.safeParse(action.name).success) {
        throw new AIError('TOOL_VALIDATION_FAILED', 'Plugin action name is invalid.');
      }
      if (seenActions.has(action.name)) {
        throw new AIError('TOOL_VALIDATION_FAILED', 'Duplicate plugin action name.');
      }
      seenActions.add(action.name);
    }

    const manifest = buildPluginManifest(connector);
    this.connectors.set(connector.id, connector);
    this.manifests.set(connector.id, manifest);
  }

  has(pluginId: string): boolean {
    return this.connectors.has(pluginId);
  }

  unregister(pluginId: string): boolean {
    this.manifests.delete(pluginId);
    return this.connectors.delete(pluginId);
  }

  get(pluginId: string): PluginConnector {
    const connector = this.connectors.get(pluginId);
    if (!connector) {
      throw new AIError('TOOL_NOT_FOUND', `Plugin ${pluginId} is not registered.`);
    }
    return connector;
  }

  listCatalog(category?: PluginCategory): PluginCatalogResponse {
    const plugins = [...this.connectors.values()]
      .filter((connector) => (category ? connector.category === category : true))
      .map((connector) => buildPluginManifest(connector));
    return PluginCatalogResponseSchema.parse({
      plugins,
      total: plugins.length,
    });
  }

  toToolDefinitions(): ToolDefinition<
    Record<string, unknown>,
    z.infer<typeof PluginInternalToolOutputSchema>
  >[] {
    const definitions: ToolDefinition<
      Record<string, unknown>,
      z.infer<typeof PluginInternalToolOutputSchema>
    >[] = [];

    for (const connector of this.connectors.values()) {
      for (const action of connector.actions) {
        definitions.push(this.createActionToolDefinition(connector, action, false));
      }
    }
    return definitions;
  }

  registerToolsInto(toolRegistry: ToolRegistry): void {
    for (const definition of this.toToolDefinitions()) {
      if (!toolRegistry.has(definition.name)) {
        toolRegistry.register(definition);
      }
    }
  }

  async invoke(
    pluginId: string,
    request: PluginInvokeRequest,
    actor: ToolActor,
    requestId: string,
    options: PluginInvokeRuntimeOptions = {},
    signal?: AbortSignal,
  ): Promise<PluginInvokeResponse> {
    const connector = this.get(pluginId);
    const action = connector.actions.find((item) => item.name === request.action);
    if (!action) {
      throw new AIError(
        'TOOL_NOT_FOUND',
        `Action ${request.action} is not registered on plugin ${pluginId}.`,
      );
    }

    if (request.allowLive && !connector.supportsLiveAdapter) {
      throw new AIError(
        'PROVIDER_NOT_CONFIGURED',
        `Plugin ${pluginId} currently only supports mock mode.`,
      );
    }
    if (request.allowLive && connector.authType !== 'none' && !connector.hasLiveCredentials()) {
      throw new AIError(
        'PROVIDER_NOT_CONFIGURED',
        `Live credentials are not configured for plugin ${pluginId}.`,
      );
    }

    const toolRegistry = new ToolRegistry();
    const toolDef = this.createActionToolDefinition(connector, action, request.allowLive);
    toolRegistry.register(toolDef);
    const executor = new ToolExecutor(toolRegistry, { retryDelayMs: () => 25 });
    const auditSink = options.auditSink ?? new InMemoryToolAuditSink();
    const invocationId = randomUUID();

    const executed = await executor.execute<z.infer<typeof PluginInternalToolOutputSchema>>(
      toolDef.name,
      request.input,
      {
        actor,
        requestId,
        audit: auditSink,
        ...(signal ? { signal } : {}),
      },
    );

    const now = options.now?.() ?? new Date();
    return PluginInvokeResponseSchema.parse({
      invocationId,
      pluginId: connector.id,
      action: action.name,
      providerMode: executed.value.providerMode,
      summary: executed.value.summary,
      data: executed.value.data,
      widgets: executed.value.widgets,
      auditRef: `tool:${toolDef.name}:${requestId}`,
      executedAt: now.toISOString(),
    });
  }

  private createActionToolDefinition(
    connector: PluginConnector,
    action: PluginActionHandler<unknown, Record<string, unknown>>,
    allowLive: boolean,
  ): ToolDefinition<Record<string, unknown>, z.infer<typeof PluginInternalToolOutputSchema>> {
    const toolName = buildPluginToolName(connector.id, action.name);
    const expectedWidgetKinds = new Set(action.widgetKinds);

    return {
      name: toolName,
      description: `${connector.name}：${action.description}`,
      parameters: action.inputSchema as z.ZodType<Record<string, unknown>>,
      result: PluginInternalToolOutputSchema,
      requiredPermissions: action.requiredPermissions,
      timeoutMs: action.timeoutMs,
      maxRetries: action.maxRetries,
      idempotent: action.idempotent,
      audit: {
        action: `plugin.${action.name}`,
        resourceType: `plugin_${connector.category}`,
      },
      execute: async (input, context) => {
        const result = await action.execute(input, {
          actor: context.actor,
          requestId: context.requestId,
          allowLive,
          widgetIdPrefix: `${connector.id}-${action.name}-${context.requestId.slice(0, 8)}`,
          ...(context.signal ? { signal: context.signal } : {}),
        });

        const parsedData = action.outputSchema.safeParse(result.data);
        if (!parsedData.success) {
          throw new AIError('TOOL_RESULT_INVALID', 'Plugin action output schema check failed.');
        }

        const parsedWidgets: ConversationWidget[] = [];
        for (const widget of result.widgets) {
          const checked = ConversationWidgetSchema.safeParse(widget);
          if (!checked.success) {
            throw new AIError('TOOL_RESULT_INVALID', 'Plugin widget payload failed validation.');
          }
          if (
            checked.data.pluginId !== connector.id ||
            !expectedWidgetKinds.has(checked.data.kind)
          ) {
            throw new AIError(
              'TOOL_RESULT_INVALID',
              'Plugin emitted an undeclared widget kind or mismatched pluginId.',
            );
          }
          parsedWidgets.push(checked.data);
        }

        return {
          providerMode: result.providerMode,
          summary: result.summary,
          data: parsedData.data,
          widgets: parsedWidgets,
        };
      },
    };
  }
}
