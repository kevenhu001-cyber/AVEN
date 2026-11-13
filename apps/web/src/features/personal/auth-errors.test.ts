import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@aven/api-client';
import { authErrorText } from './auth-errors';
import { errorText } from './api';

describe('authentication errors', () => {
  it('explains an existing account and recovery', () => {
    expect(
      authErrorText(
        new ApiClientError('HTTP_ERROR', 409, undefined, 'ACCOUNT_ALREADY_EXISTS'),
        'register',
      ),
    ).toContain('这个邮箱已有账号');
  });
  it('handles older conflict responses without stale authorization wording', () => {
    const error = new ApiClientError('HTTP_ERROR', 409);
    expect(authErrorText(error, 'register')).toContain('登录或找回密码');
    expect(errorText(error)).toContain('内容或授权已变化');
  });
  it('explains invalid login credentials', () => {
    expect(authErrorText(new ApiClientError('HTTP_ERROR', 401), 'login')).toContain(
      '邮箱或密码不正确',
    );
  });
  it('explains unavailable registration', () => {
    expect(authErrorText(new ApiClientError('HTTP_ERROR', 503), 'register')).toContain(
      '注册服务暂时不可用',
    );
  });
});
