import { AIError, type AIErrorCode } from './errors.js';

export type TimeoutOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  timeoutCode: AIErrorCode;
  cancelCode: AIErrorCode;
  timeoutMessage: string;
  cancelMessage: string;
};

export function withTimeout<T>(promise: Promise<T>, options: TimeoutOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      finish(() =>
        reject(new AIError(options.timeoutCode, options.timeoutMessage, { retryable: true })),
      );
    }, options.timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    }

    function onAbort(): void {
      finish(() =>
        reject(new AIError(options.cancelCode, options.cancelMessage, { retryable: false })),
      );
    }

    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAbortError(value: unknown): boolean {
  return value instanceof Error && (value.name === 'AbortError' || value.name === 'TimeoutError');
}
