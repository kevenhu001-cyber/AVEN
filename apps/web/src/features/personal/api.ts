import { ApiClientError, createApiClient } from '@aven/api-client';
export const api = createApiClient({ timeoutMs: 12000 });
export function webCall(signal?: AbortSignal) {
  const cookie = document.cookie.split(';').find((part) => part.trim().startsWith('aven_csrf='));
  let csrfToken: string | undefined;
  try {
    csrfToken = cookie ? decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)) : undefined;
  } catch {
    /* Invalid cookie stays unauthenticated for writes. */
  }
  return {
    auth: { kind: 'web' as const, ...(csrfToken ? { csrfToken } : {}) },
    ...(signal ? { signal } : {}),
  };
}
export function authExpired(error: unknown) {
  return error instanceof ApiClientError && error.status === 401;
}
export function errorText(error: unknown) {
  if (!(error instanceof ApiClientError)) return '请求未能完成，请检查输入后重试。';
  if (error.code === 'INVALID_REQUEST') return '请检查填写内容和当前会话，然后重试。';
  if (error.code === 'INVALID_RESPONSE') return '服务返回了无法确认的结果，请刷新状态。';
  if (error.status === 401) return '登录已失效，请重新登录。';
  if (error.status === 403) return '当前权限不足或会话校验已变化，请刷新后重试。';
  if (error.status === 404) return '内容不存在，或当前已无权访问。';
  if (error.status === 409 || error.status === 410)
    return '内容或授权已变化，请重新读取，不要重复提交旧内容。';
  if (error.status === 429) return '操作较频繁，请稍后再试。';
  if (error.status === 422) return '填写内容不符合要求，请检查后重试。';
  return '连接暂时不可用。已提交的操作可能成功，请先刷新或核对结果。';
}
export type PrivateProps = { onExpired: () => void };

export function writeUncertain(error: unknown) {
  return !(error instanceof ApiClientError) || error.status === undefined || error.status >= 500;
}
