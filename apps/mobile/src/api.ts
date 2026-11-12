import { ApiClientError, createApiClient, type ConnectionCallOptions } from '@aven/api-client';
import { fetch as nativeFetch } from 'expo/fetch';

export function validateApiOrigin(value: string, development: boolean): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !['https:', 'http:'].includes(url.protocol) ||
    (!development && url.protocol !== 'https:') ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('Invalid mobile API origin.');
  return url.origin;
}
export function createMobileApi() {
  const origin = validateApiOrigin(process.env.EXPO_PUBLIC_API_URL?.trim() ?? '', __DEV__);
  return {
    origin,
    api: createApiClient({
      baseUrl: origin,
      fetcher: nativeFetch as typeof fetch,
      timeoutMs: 15000,
    }),
  };
}
export type MobileApi = ReturnType<typeof createMobileApi>['api'];
export function mobileCall(bearerToken: string, signal?: AbortSignal): ConnectionCallOptions {
  return { auth: { kind: 'mobile', bearerToken }, ...(signal ? { signal } : {}) };
}
export function expired(error: unknown) {
  return error instanceof ApiClientError && error.status === 401;
}
export function uncertain(error: unknown) {
  return !(error instanceof ApiClientError) || error.status === undefined || error.status >= 500;
}
export function problemText(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return '登录失效，请重新登录。';
    if (error.status === 403) return '当前操作未获授权，请核对邮箱验证与权限。';
    if (error.status === 404) return '内容不存在或无权读取。';
    if (error.status === 409 || error.status === 410)
      return '版本、来源授权或保留期已变化，请重新读取。';
    if (error.status === 429) return '操作较频繁，请稍后再试。';
    if (error.code === 'INVALID_REQUEST' || error.status === 422)
      return '请检查填写内容与当前会话。';
  }
  return '无法确认请求结果。写入可能已成功，请先刷新核对，不要重复发送。';
}
