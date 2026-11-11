import { z } from 'zod';
import {
  ContextUseSchema,
  ToolPermissionSchema,
  type ContextUse,
  type ToolPermission,
} from '@aven/contracts';
import { AIError, type AIErrorCode } from './errors.js';

export const ToolAuditStatusSchema = z.enum([
  'succeeded',
  'failed',
  'denied',
  'timeout',
  'cancelled',
  'invalid_output',
]);

export type ToolAuditStatus = z.infer<typeof ToolAuditStatusSchema>;

export type ToolAuditEvent = {
  toolName: string;
  action: string;
  resourceType: string;
  actorPrincipalId: string;
  requestId: string;
  attempt: number;
  status: ToolAuditStatus;
  durationMs: number;
  errorCode?: AIErrorCode;
};

export interface ToolAuditSink {
  record(event: ToolAuditEvent): Promise<void> | void;
}

export class InMemoryToolAuditSink implements ToolAuditSink {
  readonly events: ToolAuditEvent[] = [];

  record(event: ToolAuditEvent): void {
    this.events.push(event);
  }
}

export type ToolActor = {
  principalId: string;
  userId: string;
  permissions: ReadonlySet<ToolPermission>;
  allowedUses: ReadonlySet<ContextUse>;
};

export type ToolExecutionContext = {
  actor: ToolActor;
  requestId: string;
  audit: ToolAuditSink;
  signal?: AbortSignal;
};

export type ToolDefinition<TInput, TOutput> = {
  name: string;
  description: string;
  parameters: z.ZodType<TInput>;
  result: z.ZodType<TOutput>;
  requiredPermissions: readonly ToolPermission[];
  requiredUses?: readonly ContextUse[];
  timeoutMs: number;
  maxRetries: number;
  idempotent: boolean;
  audit: { action: string; resourceType: string };
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
};

export type ToolModelDescriptor = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiredPermissions: ToolPermission[];
  requiredUses: ContextUse[];
  timeoutMs: number;
  maxRetries: number;
  idempotent: boolean;
};

export type RegisteredToolDefinition = {
  name: string;
  description: string;
  parameters: z.ZodType<unknown>;
  result: z.ZodType<unknown>;
  requiredPermissions: readonly ToolPermission[];
  requiredUses?: readonly ContextUse[];
  timeoutMs: number;
  maxRetries: number;
  idempotent: boolean;
  audit: { action: string; resourceType: string };
  execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
};

const ToolNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/);
const AuditNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/);

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredToolDefinition>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.validate(tool);
    if (this.tools.has(tool.name)) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool name is already registered.');
    }
    const registered: RegisteredToolDefinition = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as z.ZodType<unknown>,
      result: tool.result as z.ZodType<unknown>,
      requiredPermissions: tool.requiredPermissions,
      ...(tool.requiredUses === undefined ? {} : { requiredUses: tool.requiredUses }),
      timeoutMs: tool.timeoutMs,
      maxRetries: tool.maxRetries,
      idempotent: tool.idempotent,
      audit: tool.audit,
      execute: (input, context) => tool.execute(input as TInput, context),
    };
    this.tools.set(tool.name, registered);
  }

  get(name: string): RegisteredToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) throw new AIError('TOOL_NOT_FOUND', 'Tool not found.');
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listForModel(): ToolModelDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters) as Record<string, unknown>,
      requiredPermissions: [...tool.requiredPermissions],
      requiredUses: [...(tool.requiredUses ?? [])],
      timeoutMs: tool.timeoutMs,
      maxRetries: tool.maxRetries,
      idempotent: tool.idempotent,
    }));
  }

  private validate<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (!ToolNameSchema.safeParse(tool.name).success) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool name is invalid.');
    }
    if (tool.description.trim().length < 1 || tool.description.length > 500) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool description is invalid.');
    }
    if (!Number.isInteger(tool.timeoutMs) || tool.timeoutMs < 100 || tool.timeoutMs > 60000) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool timeout is invalid.');
    }
    if (!Number.isInteger(tool.maxRetries) || tool.maxRetries < 0 || tool.maxRetries > 5) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool retry limit is invalid.');
    }
    if (new Set(tool.requiredPermissions).size !== tool.requiredPermissions.length) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool permissions must be unique.');
    }
    for (const permission of tool.requiredPermissions) {
      if (!ToolPermissionSchema.safeParse(permission).success) {
        throw new AIError('TOOL_VALIDATION_FAILED', 'Tool permission is unknown.');
      }
    }
    const uses = tool.requiredUses ?? [];
    if (new Set(uses).size !== uses.length) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool uses must be unique.');
    }
    for (const use of uses) {
      if (!ContextUseSchema.safeParse(use).success) {
        throw new AIError('TOOL_VALIDATION_FAILED', 'Tool use is unknown.');
      }
    }
    if (!AuditNameSchema.safeParse(tool.audit.action).success) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool audit action is invalid.');
    }
    if (!AuditNameSchema.safeParse(tool.audit.resourceType).success) {
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool audit resource type is invalid.');
    }
    try {
      z.toJSONSchema(tool.parameters);
    } catch {
      throw new AIError(
        'TOOL_VALIDATION_FAILED',
        'Tool parameters cannot be represented as JSON Schema.',
      );
    }
  }
}
