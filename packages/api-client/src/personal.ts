import {
  AuthResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  MeResponseSchema,
  CreateMemoryRequestSchema,
  MemoryDetailSchema,
  MemoryListResponseSchema,
  OkResponseSchema,
  VerifyEmailRequestSchema,
} from '@aven/contracts';
import type { CreateMemoryRequest, RegisterRequest } from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';

export function createPersonalClient(request: ApiRequest, invalid: () => Error) {
  return {
    auth: {
      me(signal?: AbortSignal) {
        return request('/api/v1/auth/me', MeResponseSchema.parse, { signal });
      },
      loginWeb(input: { email: string; password: string }, signal?: AbortSignal) {
        const parsed = LoginRequestSchema.safeParse({ ...input, client: 'web' });
        if (!parsed.success) throw invalid();
        return request(
          '/api/v1/auth/login',
          (value) => {
            const result = AuthResponseSchema.parse(value);
            if (result.sessionToken || result.session.client !== 'web')
              throw new Error('Invalid web session.');
            return result;
          },
          { method: 'POST', body: parsed.data, signal },
        );
      },
      register(input: RegisterRequest, signal?: AbortSignal) {
        const parsed = RegisterRequestSchema.safeParse(input);
        if (!parsed.success) throw invalid();
        return request('/api/v1/auth/register', RegisterResponseSchema.parse, {
          method: 'POST',
          body: parsed.data,
          signal,
        });
      },
      verifyEmail(token: string, signal?: AbortSignal) {
        const parsed = VerifyEmailRequestSchema.safeParse({ token });
        if (!parsed.success) throw invalid();
        return request('/api/v1/auth/verify-email', OkResponseSchema.parse, {
          method: 'POST',
          body: parsed.data,
          signal,
        });
      },
      logout(call: ConnectionCallOptions) {
        return request(
          '/api/v1/auth/logout',
          (value) => {
            if (value !== undefined) throw new Error('Expected empty response.');
          },
          authenticatedOptions(call, true, invalid),
        );
      },
    },
    memories: {
      list(call: ConnectionCallOptions, use?: 'sharing') {
        return request(
          `/api/v1/memories${use ? '/usable?use=sharing&limit=100' : '?limit=100'}`,
          MemoryListResponseSchema.parse,
          authenticatedOptions(call, false, invalid),
        );
      },
      create(input: CreateMemoryRequest, call: ConnectionCallOptions) {
        const parsed = CreateMemoryRequestSchema.safeParse(input);
        if (!parsed.success) throw invalid();
        return request('/api/v1/memories', MemoryDetailSchema.parse, {
          ...authenticatedOptions(call, true, invalid),
          body: parsed.data,
        });
      },
    },
  };
}
