import { AIError, type AIErrorCode } from './errors.js';
import { delay, withTimeout } from './timeout.js';
import type {
  RegisteredToolDefinition,
  ToolAuditEvent,
  ToolAuditStatus,
  ToolExecutionContext,
  ToolRegistry,
} from './tools.js';

export type ToolExecutionOptions = {
  retryDelayMs?: (attempt: number) => number;
};

export type ToolExecutionResult<TOutput> = {
  toolName: string;
  value: TOutput;
  attempts: number;
  durationMs: number;
};

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: ToolExecutionOptions = {},
  ) {}

  async execute<TOutput = unknown>(
    name: string,
    rawInput: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<TOutput>> {
    const tool = this.registry.get(name);
    const actor = context.actor;

    for (const permission of tool.requiredPermissions) {
      if (!actor.permissions.has(permission)) {
        await this.record(context, tool, 0, 'denied', 0, 'TOOL_PERMISSION_DENIED');
        throw new AIError('TOOL_PERMISSION_DENIED', 'Tool permission is required.');
      }
    }
    for (const use of tool.requiredUses ?? []) {
      if (!actor.allowedUses.has(use)) {
        await this.record(context, tool, 0, 'denied', 0, 'TOOL_SCOPE_DENIED');
        throw new AIError('TOOL_SCOPE_DENIED', 'Tool data scope is not allowed.');
      }
    }

    const parsed = tool.parameters.safeParse(rawInput);
    if (!parsed.success) {
      await this.record(context, tool, 0, 'failed', 0, 'TOOL_VALIDATION_FAILED');
      throw new AIError('TOOL_VALIDATION_FAILED', 'Tool parameters are invalid.', {
        details: {
          fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))],
        },
      });
    }

    const started = Date.now();
    let lastError: AIError | undefined;
    for (let attempt = 1; attempt <= tool.maxRetries + 1; attempt += 1) {
      const attemptStarted = Date.now();
      try {
        const value = await withTimeout(tool.execute(parsed.data, context), {
          timeoutMs: tool.timeoutMs,
          ...(context.signal ? { signal: context.signal } : {}),
          timeoutCode: 'TOOL_TIMEOUT',
          cancelCode: 'TOOL_CANCELLED',
          timeoutMessage: 'Tool execution timed out.',
          cancelMessage: 'Tool execution was cancelled.',
        });
        const result = tool.result.safeParse(value);
        if (!result.success) {
          await this.record(
            context,
            tool,
            attempt,
            'invalid_output',
            Date.now() - attemptStarted,
            'TOOL_RESULT_INVALID',
          );
          throw new AIError('TOOL_RESULT_INVALID', 'Tool result is invalid.', {
            details: {
              fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')))],
            },
          });
        }
        await this.record(context, tool, attempt, 'succeeded', Date.now() - attemptStarted);
        return {
          toolName: name,
          value: result.data as TOutput,
          attempts: attempt,
          durationMs: Date.now() - started,
        };
      } catch (error) {
        const aiError =
          error instanceof AIError
            ? error
            : new AIError('TOOL_EXECUTION_FAILED', 'Tool execution failed.');
        lastError = aiError;
        const status = this.statusFor(aiError.code);
        await this.record(
          context,
          tool,
          attempt,
          status,
          Date.now() - attemptStarted,
          aiError.code,
        );
        const canRetry = tool.idempotent && aiError.retryable && attempt <= tool.maxRetries;
        if (!canRetry) throw aiError;
        await delay(
          this.options.retryDelayMs?.(attempt) ?? Math.min(1000, 50 * 2 ** (attempt - 1)),
        );
      }
    }
    throw lastError ?? new AIError('TOOL_EXECUTION_FAILED', 'Tool execution failed.');
  }

  private statusFor(code: AIErrorCode): ToolAuditStatus {
    if (code === 'TOOL_TIMEOUT') return 'timeout';
    if (code === 'TOOL_CANCELLED') return 'cancelled';
    if (code === 'TOOL_RESULT_INVALID') return 'invalid_output';
    return 'failed';
  }

  private async record(
    context: ToolExecutionContext,
    tool: RegisteredToolDefinition,
    attempt: number,
    status: ToolAuditStatus,
    durationMs: number,
    errorCode?: AIErrorCode,
  ): Promise<void> {
    const event: ToolAuditEvent = {
      toolName: tool.name,
      action: tool.audit.action,
      resourceType: tool.audit.resourceType,
      actorPrincipalId: context.actor.principalId,
      requestId: context.requestId,
      attempt,
      status,
      durationMs,
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    try {
      await context.audit.record(event);
    } catch {
      throw new AIError('TOOL_AUDIT_FAILED', 'Tool audit could not be recorded.');
    }
  }
}
