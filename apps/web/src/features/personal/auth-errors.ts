import { ApiClientError } from '@aven/api-client';
import { errorText } from './api';
export function existingRegistration(error: unknown) {
  return error instanceof ApiClientError && error.apiCode === 'ACCOUNT_ALREADY_EXISTS';
}
export function authErrorText(error: unknown, mode: 'login' | 'register') {
  if (existingRegistration(error)) return '这个邮箱已有账号，请直接登录；忘记密码可以找回。';
  if (error instanceof ApiClientError) {
    if (mode === 'register' && error.status === 409)
      return '这个邮箱可能已注册，请尝试登录或找回密码。';
    if (mode === 'login' && error.status === 401) return '邮箱或密码不正确，请重新输入或找回密码。';
    if (mode === 'register' && error.status === 503) return '注册服务暂时不可用，请稍后重试。';
  }
  return errorText(error);
}
