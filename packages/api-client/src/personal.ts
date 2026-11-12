import {
  AuthResponseSchema,
  ConfirmMemoryRequestSchema,
  CreateMemoryRequestSchema,
  ExtractMemoryRequestSchema,
  ExtractMemoryResponseSchema,
  LoginRequestSchema,
  MemoryCandidateListResponseSchema,
  MemoryDetailSchema,
  MemoryListResponseSchema,
  OkResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  MeResponseSchema,
  RejectMemoryRequestSchema,
  RequestIdSchema,
  UpdateMemoryRequestSchema,
  VerifyEmailRequestSchema,
  SessionListResponseSchema,
  ChangePasswordSchema,
  PasswordResetRequestSchema,
  PasswordResetSchema,
  UpdateProfileRequestSchema,
} from '@aven/contracts';
import type {
  ConfirmMemoryRequest,
  CreateMemoryRequest,
  ExtractMemoryRequest,
  RegisterRequest,
  UpdateMemoryRequest,
  ChangePassword,
  UpdateProfileRequest,
} from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';

export function createPersonalClient(request: ApiRequest, invalid: () => Error) {
  function memoryId(value: string) {
    const parsed = RequestIdSchema.safeParse(value);
    if (!parsed.success) throw invalid();
    return parsed.data;
  }
  return {
    auth: {
      me(signal?: AbortSignal, call?: ConnectionCallOptions) {
        return request('/api/v1/auth/me', MeResponseSchema.parse, {
          ...(call ? authenticatedOptions(call, false, invalid) : {}),
          signal: signal ?? call?.signal,
        });
      },
      loginMobile(input: { email: string; password: string }, signal?: AbortSignal) {
        const parsed = LoginRequestSchema.safeParse({ ...input, client: 'mobile' });
        if (!parsed.success) throw invalid();
        return request(
          '/api/v1/auth/login',
          (value) => {
            const result = AuthResponseSchema.parse(value);
            if (
              result.session.client !== 'mobile' ||
              !result.sessionToken ||
              /\s/.test(result.sessionToken) ||
              result.csrfToken !== undefined
            )
              throw new Error('Invalid mobile session.');
            return { ...result, sessionToken: result.sessionToken };
          },
          { method: 'POST', body: parsed.data, credentials: 'omit', signal },
        );
      },
      sessions(call: ConnectionCallOptions) {
        return request(
          '/api/v1/auth/sessions',
          SessionListResponseSchema.parse,
          authenticatedOptions(call, false, invalid),
        );
      },
      revokeSession(id: string, call: ConnectionCallOptions) {
        return request(
          `/api/v1/auth/sessions/${memoryId(id)}/revoke`,
          empty,
          authenticatedOptions(call, true, invalid),
        );
      },
      updateProfile(input: UpdateProfileRequest, call: ConnectionCallOptions) {
        const parsed = UpdateProfileRequestSchema.safeParse(input);
        if (!parsed.success) throw invalid();
        return request('/api/v1/me', MeResponseSchema.parse, {
          ...authenticatedOptions(call, 'PATCH', invalid),
          body: parsed.data,
        });
      },
      changePassword(input: ChangePassword, call: ConnectionCallOptions) {
        const parsed = ChangePasswordSchema.safeParse(input);
        if (!parsed.success) throw invalid();
        return request('/api/v1/auth/password/change', empty, {
          ...authenticatedOptions(call, true, invalid),
          body: parsed.data,
        });
      },
      requestPasswordReset(email: string, signal?: AbortSignal) {
        const parsed = PasswordResetRequestSchema.safeParse({ email });
        if (!parsed.success) throw invalid();
        return request('/api/v1/auth/password/reset-request', OkResponseSchema.parse, {
          method: 'POST',
          body: parsed.data,
          credentials: 'omit',
          signal,
        });
      },
      resetPassword(token: string, password: string, signal?: AbortSignal) {
        const parsed = PasswordResetSchema.safeParse({ token, password });
        if (!parsed.success) throw invalid();
        return request('/api/v1/auth/password/reset', empty, {
          method: 'POST',
          body: parsed.data,
          credentials: 'omit',
          signal,
        });
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
      async candidates(call: ConnectionCallOptions) {
        return request(
          '/api/v1/memories/candidates?limit=50',
          MemoryCandidateListResponseSchema.parse,
          authenticatedOptions(call, false, invalid),
        );
      },
      async extract(input: ExtractMemoryRequest, call: ConnectionCallOptions) {
        const parsed = ExtractMemoryRequestSchema.safeParse(input);
        if (!parsed.success) throw invalid();
        return request('/api/v1/memories/extract', ExtractMemoryResponseSchema.parse, {
          ...authenticatedOptions(call, true, invalid),
          body: parsed.data,
        });
      },
      async confirm(id: string, input: ConfirmMemoryRequest, call: ConnectionCallOptions) {
        const parsed = ConfirmMemoryRequestSchema.safeParse(input);
        if (!parsed.success) throw invalid();
        return request(`/api/v1/memories/${memoryId(id)}/confirm`, MemoryDetailSchema.parse, {
          ...authenticatedOptions(call, true, invalid),
          body: parsed.data,
        });
      },
      async reject(id: string, expectedVersion: number, call: ConnectionCallOptions) {
        const parsed = RejectMemoryRequestSchema.safeParse({ expectedVersion });
        if (!parsed.success) throw invalid();
        return request(`/api/v1/memories/${memoryId(id)}/reject`, MemoryDetailSchema.parse, {
          ...authenticatedOptions(call, true, invalid),
          body: parsed.data,
        });
      },
      async update(id: string, input: UpdateMemoryRequest, call: ConnectionCallOptions) {
        const parsed = UpdateMemoryRequestSchema.safeParse(input);
        if (!parsed.success) throw invalid();
        return request(`/api/v1/memories/${memoryId(id)}`, MemoryDetailSchema.parse, {
          ...authenticatedOptions(call, 'PATCH', invalid),
          body: parsed.data,
        });
      },
      async remove(id: string, expectedVersion: number, call: ConnectionCallOptions) {
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw invalid();
        return request(
          `/api/v1/memories/${memoryId(id)}?expectedVersion=${expectedVersion}`,
          (value) => {
            if (value !== undefined) throw new Error('Expected empty response.');
          },
          authenticatedOptions(call, 'DELETE', invalid),
        );
      },
    },
  };
}

function empty(value: unknown) {
  if (value !== undefined) throw new Error('Expected empty response.');
}
