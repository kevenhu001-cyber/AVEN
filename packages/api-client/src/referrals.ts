import {
  ConsentPreviewSchema,
  CreateConsentPreviewRequestSchema,
  CreateReferralRequestSchema,
  ReferralDecisionRequestSchema,
  ReferralListResponseSchema,
  ReferralSchema,
  ReferralSharedSnapshotResponseSchema,
  ReferralSupplementListResponseSchema,
  ReferralSupplementSchema,
  RevokeConsentRequestSchema,
  SubmitReferralSupplementRequestSchema,
  WithdrawReferralRequestSchema,
  type ConsentPreview,
  type CreateConsentPreviewRequest,
  type CreateReferralRequest,
  type Referral,
  type ReferralDecisionRequest,
  type ReferralListResponse,
  type ReferralSharedSnapshotResponse,
  type ReferralSupplement,
  type ReferralSupplementListResponse,
  type RevokeConsentRequest,
  type SubmitReferralSupplementRequest,
  type WithdrawReferralRequest,
} from '@aven/contracts';
import type { TransportOptions } from './connections';

export type ReferralCallOptions = {
  csrfToken?: string;
  bearerToken?: string;
  signal?: AbortSignal;
};

export type ReferralsClient = ReturnType<typeof createReferralsClient>;

export function createReferralsClient(
  request: <T>(path: string, parse: (value: unknown) => T, init?: TransportOptions) => Promise<T>,
  invalidRequest: () => Error,
) {
  function authOptions(
    options: ReferralCallOptions,
    method: 'GET' | 'POST' | 'DELETE',
    body?: unknown,
  ): TransportOptions {
    const headers: Record<string, string> = {};
    if (options.bearerToken) {
      headers.Authorization = `Bearer ${options.bearerToken}`;
    }
    if (options.csrfToken) {
      headers['x-csrf-token'] = options.csrfToken;
    }
    return {
      method,
      headers,
      body,
      signal: options.signal,
    };
  }

  return {
    async createPreview(
      input: CreateConsentPreviewRequest,
      options: ReferralCallOptions = {},
    ): Promise<ConsentPreview> {
      const parsed = CreateConsentPreviewRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      return request(
        '/api/v1/consents/previews',
        (val: unknown) => ConsentPreviewSchema.parse(val),
        authOptions(options, 'POST', parsed.data),
      );
    },

    async createReferral(
      input: CreateReferralRequest,
      options: ReferralCallOptions = {},
    ): Promise<Referral> {
      const parsed = CreateReferralRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      return request(
        '/api/v1/referrals',
        (val: unknown) => ReferralSchema.parse(val),
        authOptions(options, 'POST', parsed.data),
      );
    },

    async listMyReferrals(options: ReferralCallOptions = {}): Promise<ReferralListResponse> {
      return request(
        '/api/v1/referrals/me',
        (val: unknown) => ReferralListResponseSchema.parse(val),
        authOptions(options, 'GET'),
      );
    },

    async listOrganizationReferrals(
      organizationId: string,
      options: ReferralCallOptions = {},
    ): Promise<ReferralListResponse> {
      return request(
        `/api/v1/organizations/${organizationId}/referrals`,
        (val: unknown) => ReferralListResponseSchema.parse(val),
        authOptions(options, 'GET'),
      );
    },

    async getReferral(id: string, options: ReferralCallOptions = {}): Promise<Referral> {
      return request(
        `/api/v1/referrals/${id}`,
        (val: unknown) => ReferralSchema.parse(val),
        authOptions(options, 'GET'),
      );
    },

    async getSharedSnapshot(
      id: string,
      options: ReferralCallOptions = {},
    ): Promise<ReferralSharedSnapshotResponse> {
      return request(
        `/api/v1/referrals/${id}/shared-snapshot`,
        (val: unknown) => ReferralSharedSnapshotResponseSchema.parse(val),
        authOptions(options, 'GET'),
      );
    },

    async decide(
      id: string,
      input: ReferralDecisionRequest,
      options: ReferralCallOptions = {},
    ): Promise<Referral> {
      const parsed = ReferralDecisionRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      return request(
        `/api/v1/referrals/${id}/decisions`,
        (val: unknown) => ReferralSchema.parse(val),
        authOptions(options, 'POST', parsed.data),
      );
    },

    async withdraw(
      id: string,
      input: WithdrawReferralRequest = {},
      options: ReferralCallOptions = {},
    ): Promise<Referral> {
      const parsed = WithdrawReferralRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      return request(
        `/api/v1/referrals/${id}/withdraw`,
        (val: unknown) => ReferralSchema.parse(val),
        authOptions(options, 'POST', parsed.data),
      );
    },

    async submitSupplement(
      id: string,
      input: SubmitReferralSupplementRequest,
      options: ReferralCallOptions = {},
    ): Promise<ReferralSupplement> {
      const parsed = SubmitReferralSupplementRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      return request(
        `/api/v1/referrals/${id}/supplements`,
        (val: unknown) => ReferralSupplementSchema.parse(val),
        authOptions(options, 'POST', parsed.data),
      );
    },

    async listSupplements(
      id: string,
      options: ReferralCallOptions = {},
    ): Promise<ReferralSupplementListResponse> {
      return request(
        `/api/v1/referrals/${id}/supplements`,
        (val: unknown) => ReferralSupplementListResponseSchema.parse(val),
        authOptions(options, 'GET'),
      );
    },

    async revokeConsent(
      grantId: string,
      input: RevokeConsentRequest = { reason: 'User requested revocation' },
      options: ReferralCallOptions = {},
    ): Promise<{ revoked: boolean }> {
      const parsed = RevokeConsentRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      return request(
        `/api/v1/consents/grants/${grantId}/revoke`,
        (val: unknown) => val as { revoked: boolean },
        authOptions(options, 'POST', parsed.data),
      );
    },
  };
}
