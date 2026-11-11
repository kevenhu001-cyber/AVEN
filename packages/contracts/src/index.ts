import { z } from 'zod';

export const RequestIdSchema = z.uuid();
export const ApiErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CONSENT_REVOKED',
  'CONSENT_EXPIRED',
  'CONSENT_SCOPE_MISMATCH',
  'OPPORTUNITY_CLOSED',
  'OPPORTUNITY_EXPIRED',
  'OPPORTUNITY_FULL',
  'MATCH_NOT_AVAILABLE',
  'REFERRAL_NOT_AVAILABLE',
  'REFERRAL_ALREADY_DECIDED',
  'REFERRAL_EXPIRED',
  'PREVIEW_EXPIRED',
  'PREVIEW_STALE',
  'EVENT_HISTORY_EXPIRED',
  'INVALID_EVENT_CURSOR',
  'RELATIONSHIP_EXISTS',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'SERVICE_NOT_READY',
  'INTERNAL',
]);
export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().min(1),
        request_id: RequestIdSchema,
        retryable: z.boolean(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export const LivenessResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.enum(['api', 'worker']),
    stage: z.literal('foundation'),
    request_id: RequestIdSchema,
  })
  .strict();

export const ReadinessChecksSchema = z
  .object({
    database: z.boolean(),
    redis: z.boolean(),
    migrations: z.boolean(),
    consumers: z.boolean().optional(),
  })
  .strict();

export const ReadinessResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.enum(['api', 'worker']),
    stage: z.literal('foundation'),
    checks: ReadinessChecksSchema,
    request_id: RequestIdSchema,
  })
  .strict();

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
export const PasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine(
    (value) =>
      [...value].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 0x20 && code !== 0x7f;
      }),
    'Password contains control characters.',
  );
export const DisplayNameSchema = z.string().trim().min(1).max(120);

export const RegisterRequestSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    displayName: DisplayNameSchema,
  })
  .strict();

export const LoginRequestSchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(128),
    client: z.enum(['web', 'mobile']).default('web'),
  })
  .strict();

export const AuthUserSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    email: z.email(),
    emailVerified: z.boolean(),
    locale: z.string(),
    timezone: z.string(),
  })
  .strict();

export const AuthSessionSchema = z
  .object({
    id: z.uuid(),
    client: z.enum(['web', 'mobile']),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    current: z.boolean(),
  })
  .strict();

export const AuthResponseSchema = z
  .object({
    user: AuthUserSchema,
    session: AuthSessionSchema,
    csrfToken: z.string().optional(),
    sessionToken: z.string().optional(),
  })
  .strict();

export const MeResponseSchema = z
  .object({ user: AuthUserSchema, session: AuthSessionSchema })
  .strict();

export const SessionListResponseSchema = z.object({ data: z.array(AuthSessionSchema) }).strict();

export const RegisterResponseSchema = z
  .object({ user: AuthUserSchema, verificationRequired: z.literal(true) })
  .strict();

export const VerifyEmailRequestSchema = z.object({ token: z.string().min(20).max(256) }).strict();

export const PasswordResetRequestSchema = z.object({ email: EmailSchema }).strict();

export const PasswordResetSchema = z
  .object({ token: z.string().min(20).max(256), password: PasswordSchema })
  .strict();

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordSchema,
  })
  .strict();

export const OkResponseSchema = z.object({ ok: z.literal(true) }).strict();

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(value: string): boolean {
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}

export const TimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimezone, 'Invalid IANA timezone.');
export const LocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .refine(isValidLocale, 'Invalid locale.');

export const UpdateProfileRequestSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    locale: LocaleSchema.optional(),
    timezone: TimezoneSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.displayName !== undefined || value.locale !== undefined || value.timezone !== undefined,
    'At least one profile field is required.',
  );

export const CampusSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    city: z.string().nullable(),
    country: z.string(),
  })
  .strict();

export const CampusListResponseSchema = z.object({ data: z.array(CampusSchema) }).strict();

export const CampusMembershipSchema = z
  .object({
    id: z.uuid(),
    campusId: z.uuid(),
    campusName: z.string(),
    status: z.enum(['pending', 'verified', 'rejected', 'revoked']),
    verificationMethod: z.enum(['email_domain', 'manual', 'student_id']).nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const CampusMembershipListResponseSchema = z
  .object({ data: z.array(CampusMembershipSchema) })
  .strict();

export const RequestCampusMembershipSchema = z.object({ campusId: z.uuid() }).strict();

export const OrganizationTypeSchema = z.enum([
  'lab',
  'research_group',
  'club',
  'department',
  'company',
  'other',
]);
export const OrganizationRoleSchema = z.enum(['owner', 'admin', 'member']);
export const OrganizationMembershipStatusSchema = z.enum(['invited', 'active', 'removed', 'left']);
export const OrganizationVerificationStatusSchema = z.enum([
  'unverified',
  'pending',
  'verified',
  'rejected',
]);

export const CreateOrganizationRequestSchema = z
  .object({
    name: DisplayNameSchema,
    slug: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, digits, and hyphens.'),
    description: z.string().trim().max(2000).optional(),
    type: OrganizationTypeSchema,
    campusId: z.uuid().optional(),
  })
  .strict();

export const OrganizationSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    type: OrganizationTypeSchema,
    role: OrganizationRoleSchema,
    status: OrganizationMembershipStatusSchema,
    canRepresent: z.boolean(),
    joinedAt: z.iso.datetime(),
  })
  .strict();

export const OrganizationListResponseSchema = z
  .object({ data: z.array(OrganizationSummarySchema) })
  .strict();

export const OrganizationDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    type: OrganizationTypeSchema,
    campusId: z.uuid().nullable(),
    verificationStatus: OrganizationVerificationStatusSchema,
    role: OrganizationRoleSchema,
    canRepresent: z.boolean(),
    memberCount: z.number().int().nonnegative(),
  })
  .strict();

export const OrganizationMemberSchema = z
  .object({
    userId: z.uuid(),
    displayName: z.string(),
    role: OrganizationRoleSchema,
    status: OrganizationMembershipStatusSchema,
    canRepresent: z.boolean(),
    joinedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const OrganizationMemberListResponseSchema = z
  .object({ data: z.array(OrganizationMemberSchema) })
  .strict();

export const InviteOrganizationMemberRequestSchema = z
  .object({ email: EmailSchema, role: z.enum(['admin', 'member']) })
  .strict();

export const OrganizationInvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: OrganizationRoleSchema,
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const OrganizationInvitationListResponseSchema = z
  .object({ data: z.array(OrganizationInvitationSchema) })
  .strict();

export const AcceptOrganizationInvitationRequestSchema = z
  .object({ token: z.string().min(20).max(256) })
  .strict();

export const AcceptOrganizationInvitationResponseSchema = z
  .object({
    organizationId: z.uuid(),
    membershipId: z.uuid(),
    role: OrganizationRoleSchema,
  })
  .strict();

export const UpdateOrganizationMemberRoleRequestSchema = z
  .object({ role: z.enum(['admin', 'member']) })
  .strict();

export const MemoryKindSchema = z.enum([
  'interest',
  'skill',
  'project',
  'goal',
  'preference',
  'experience',
  'education',
  'other',
]);
export const SensitivitySchema = z.enum(['low', 'normal', 'high']);
export const DisplayAudienceSchema = z.enum(['owner', 'campus', 'public']);
export const ContextUseSchema = z.enum(['self_ai', 'matching', 'sharing']);
export const MemoryStatusSchema = z.enum([
  'pending_confirmation',
  'confirmed',
  'rejected',
  'expired',
  'deleted',
]);
export const MemorySourceTypeSchema = z.enum([
  'user_input',
  'conversation',
  'file',
  'import',
  'agent_extraction',
]);

const AllowedUsesSchema = z
  .array(ContextUseSchema)
  .max(3)
  .refine((values) => new Set(values).size === values.length, 'Allowed uses must be unique.');

export const CreateMemoryRequestSchema = z
  .object({
    kind: MemoryKindSchema,
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(20000),
    structuredValue: z.record(z.string(), z.unknown()).optional(),
    sensitivity: SensitivitySchema.default('normal'),
    displayAudience: DisplayAudienceSchema.default('owner'),
    discoverable: z.boolean().default(false),
    allowedUses: AllowedUsesSchema.default([]),
    campusId: z.uuid().optional(),
    validUntil: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.displayAudience === 'campus' && !value.campusId) {
      context.addIssue({
        code: 'custom',
        path: ['campusId'],
        message: 'Campus audience requires a campus.',
      });
    }
    if (value.displayAudience !== 'campus' && value.campusId) {
      context.addIssue({
        code: 'custom',
        path: ['campusId'],
        message: 'Campus id requires campus audience.',
      });
    }
    if (value.discoverable && value.displayAudience === 'owner') {
      context.addIssue({
        code: 'custom',
        path: ['discoverable'],
        message: 'Owner-only memory cannot be discoverable.',
      });
    }
  });

export const UpdateMemoryRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    title: z.string().trim().min(1).max(160).optional(),
    content: z.string().trim().min(1).max(20000).optional(),
    structuredValue: z.record(z.string(), z.unknown()).nullable().optional(),
    sensitivity: SensitivitySchema.optional(),
    displayAudience: DisplayAudienceSchema.optional(),
    discoverable: z.boolean().optional(),
    allowedUses: AllowedUsesSchema.optional(),
    campusId: z.uuid().nullable().optional(),
    validUntil: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.content !== undefined ||
      value.structuredValue !== undefined ||
      value.sensitivity !== undefined ||
      value.displayAudience !== undefined ||
      value.discoverable !== undefined ||
      value.allowedUses !== undefined ||
      value.campusId !== undefined ||
      value.validUntil !== undefined,
    'At least one memory field is required.',
  );

export const MemoryPolicySchema = z
  .object({
    displayAudience: DisplayAudienceSchema,
    discoverable: z.boolean(),
    allowedUses: z.array(ContextUseSchema),
    campusId: z.uuid().nullable(),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const MemoryItemSchema = z
  .object({
    id: z.uuid(),
    kind: MemoryKindSchema,
    title: z.string(),
    content: z.string(),
    structuredValue: z.record(z.string(), z.unknown()).nullable(),
    sensitivity: SensitivitySchema,
    status: MemoryStatusSchema,
    version: z.number().int().positive(),
    validFrom: z.iso.datetime().nullable(),
    validUntil: z.iso.datetime().nullable(),
    confirmedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    policy: MemoryPolicySchema,
    sourceCount: z.number().int().nonnegative(),
  })
  .strict();

export const MemorySourceSchema = z
  .object({
    id: z.uuid(),
    sourceType: MemorySourceTypeSchema,
    sourceId: z.uuid().nullable(),
    sourceVersion: z.string().nullable(),
    excerpt: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const MemoryDetailSchema = MemoryItemSchema.extend({
  sources: z.array(MemorySourceSchema),
}).strict();

export const MemoryListResponseSchema = z
  .object({
    data: z.array(MemoryItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const MemoryCandidateSchema = MemoryItemSchema.extend({
  source: MemorySourceSchema.nullable(),
}).strict();

export const MemoryCandidateListResponseSchema = z
  .object({
    data: z.array(MemoryCandidateSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const ExtractMemorySourceTypeSchema = z.enum([
  'conversation',
  'file',
  'import',
  'agent_extraction',
]);

export const ExtractMemoryRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(20000),
    sourceType: ExtractMemorySourceTypeSchema.default('agent_extraction'),
    sourceId: z.uuid().optional(),
    sourceVersion: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const ExtractMemoryResponseSchema = z
  .object({
    extractor: z.literal('mock_rules_v1'),
    data: z.array(MemoryCandidateSchema),
  })
  .strict();

export const ConfirmMemoryRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    kind: MemoryKindSchema.optional(),
    title: z.string().trim().min(1).max(160).optional(),
    content: z.string().trim().min(1).max(20000).optional(),
    structuredValue: z.record(z.string(), z.unknown()).nullable().optional(),
    sensitivity: SensitivitySchema.optional(),
    displayAudience: DisplayAudienceSchema.optional(),
    discoverable: z.boolean().optional(),
    allowedUses: AllowedUsesSchema.optional(),
    campusId: z.uuid().nullable().optional(),
    validUntil: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const RejectMemoryRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
export type ReadinessChecks = z.infer<typeof ReadinessChecksSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;
export type PasswordReset = z.infer<typeof PasswordResetSchema>;
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;
export type OkResponse = z.infer<typeof OkResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export type Campus = z.infer<typeof CampusSchema>;
export type CampusListResponse = z.infer<typeof CampusListResponseSchema>;
export type CampusMembership = z.infer<typeof CampusMembershipSchema>;
export type CampusMembershipListResponse = z.infer<typeof CampusMembershipListResponseSchema>;
export type RequestCampusMembership = z.infer<typeof RequestCampusMembershipSchema>;
export type OrganizationType = z.infer<typeof OrganizationTypeSchema>;
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;
export type OrganizationMembershipStatus = z.infer<typeof OrganizationMembershipStatusSchema>;
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequestSchema>;
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;
export type OrganizationListResponse = z.infer<typeof OrganizationListResponseSchema>;
export type OrganizationDetail = z.infer<typeof OrganizationDetailSchema>;
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
export type OrganizationMemberListResponse = z.infer<typeof OrganizationMemberListResponseSchema>;
export type InviteOrganizationMemberRequest = z.infer<typeof InviteOrganizationMemberRequestSchema>;
export type OrganizationInvitation = z.infer<typeof OrganizationInvitationSchema>;
export type OrganizationInvitationListResponse = z.infer<
  typeof OrganizationInvitationListResponseSchema
>;
export type AcceptOrganizationInvitationRequest = z.infer<
  typeof AcceptOrganizationInvitationRequestSchema
>;
export type AcceptOrganizationInvitationResponse = z.infer<
  typeof AcceptOrganizationInvitationResponseSchema
>;
export type UpdateOrganizationMemberRoleRequest = z.infer<
  typeof UpdateOrganizationMemberRoleRequestSchema
>;
export type MemoryKind = z.infer<typeof MemoryKindSchema>;
export type Sensitivity = z.infer<typeof SensitivitySchema>;
export type DisplayAudience = z.infer<typeof DisplayAudienceSchema>;
export type ContextUse = z.infer<typeof ContextUseSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;
export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>;
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequestSchema>;
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequestSchema>;
export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;
export type MemoryItem = z.infer<typeof MemoryItemSchema>;
export type MemorySource = z.infer<typeof MemorySourceSchema>;
export type MemoryDetail = z.infer<typeof MemoryDetailSchema>;
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
export type MemoryCandidateListResponse = z.infer<typeof MemoryCandidateListResponseSchema>;
export type ExtractMemorySourceType = z.infer<typeof ExtractMemorySourceTypeSchema>;
export type ExtractMemoryRequest = z.infer<typeof ExtractMemoryRequestSchema>;
export type ExtractMemoryResponse = z.infer<typeof ExtractMemoryResponseSchema>;
export type ConfirmMemoryRequest = z.infer<typeof ConfirmMemoryRequestSchema>;
export type RejectMemoryRequest = z.infer<typeof RejectMemoryRequestSchema>;
