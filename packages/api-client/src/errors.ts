import type { ApiErrorCode } from '@aven/contracts';

export class ApiClientError extends Error {
  constructor(
    public readonly code:
      | 'NETWORK_ERROR'
      | 'TIMEOUT'
      | 'CANCELLED'
      | 'INVALID_REQUEST'
      | 'INVALID_RESPONSE'
      | 'HTTP_ERROR',
    public readonly status?: number,
    public readonly requestId?: string,
    public readonly apiCode?: ApiErrorCode,
  ) {
    super(code);
    this.name = 'ApiClientError';
  }
}
