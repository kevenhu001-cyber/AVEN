export type AIErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_CANCELLED'
  | 'PROVIDER_INVALID_REQUEST'
  | 'PROVIDER_INVALID_OUTPUT'
  | 'MOCK_RESULT_REQUIRED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_VALIDATION_FAILED'
  | 'TOOL_PERMISSION_DENIED'
  | 'TOOL_SCOPE_DENIED'
  | 'TOOL_TIMEOUT'
  | 'TOOL_CANCELLED'
  | 'TOOL_EXECUTION_FAILED'
  | 'TOOL_RESULT_INVALID'
  | 'TOOL_AUDIT_FAILED'
  | 'RUNTIME_FAILED';

const retryableCodes = new Set<AIErrorCode>([
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'TOOL_TIMEOUT',
]);

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: AIErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.retryable = options.retryable ?? retryableCodes.has(code);
    this.details = options.details;
  }
}

export function isAIError(value: unknown): value is AIError {
  return value instanceof AIError;
}

export function toAIError(value: unknown, fallbackCode: AIErrorCode): AIError {
  if (value instanceof AIError) return value;
  return new AIError(fallbackCode, 'The AI operation could not be completed.', {
    retryable: false,
  });
}
