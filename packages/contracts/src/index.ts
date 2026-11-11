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
  'SOURCE_INVALIDATED',
  'ACTION_NOT_CONFIRMABLE',
  'ACTION_EXPIRED',
  'ACTION_TOKEN_INVALID',
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

export const UpdateOrganizationRequestSchema = z
  .object({
    name: DisplayNameSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    websiteUrl: z.string().trim().max(500).nullable().optional(),
    logoUrl: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const PublicOrganizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    type: OrganizationTypeSchema,
    campusId: z.uuid().nullable(),
    websiteUrl: z.string().nullable(),
    logoUrl: z.string().nullable(),
    verificationStatus: OrganizationVerificationStatusSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

export const OpportunityStageSchema = z.enum(['undergraduate', 'master', 'phd', 'postdoc', 'any']);

export const OpportunityStatusSchema = z.enum(['draft', 'open', 'paused', 'closed', 'expired']);

export const OpportunityVisibilitySchema = z.enum(['organization', 'campus', 'public']);

export const CreateOpportunityDraftRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2000),
    description: z.string().trim().min(1).max(20000),
    domains: z.array(z.string().trim().min(1).max(50)).default([]),
    requirements: z.array(z.string().trim().min(1).max(200)).default([]),
    stage: OpportunityStageSchema.default('any'),
    commitmentHoursPerWeek: z.number().int().min(1).max(40).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    remoteOk: z.boolean().default(false),
    headcount: z.number().int().min(1).max(100).default(1),
    deadline: z.iso.datetime().nullable().optional(),
    visibility: OpportunityVisibilitySchema.default('campus'),
    contactUserId: z.uuid().optional(),
  })
  .strict();

export const UpdateOpportunityRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().min(1).max(2000).optional(),
    description: z.string().trim().min(1).max(20000).optional(),
    domains: z.array(z.string().trim().min(1).max(50)).optional(),
    requirements: z.array(z.string().trim().min(1).max(200)).optional(),
    stage: OpportunityStageSchema.optional(),
    commitmentHoursPerWeek: z.number().int().min(1).max(40).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    remoteOk: z.boolean().optional(),
    headcount: z.number().int().min(1).max(100).optional(),
    deadline: z.iso.datetime().nullable().optional(),
    visibility: OpportunityVisibilitySchema.optional(),
    contactUserId: z.uuid().optional(),
  })
  .strict();

export const OpportunityLifecycleActionRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const OpportunitySummarySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid().optional(),
    organizationName: z.string().optional(),
    organizationSlug: z.string().optional(),
    campusId: z.uuid().nullable().optional(),
    title: z.string(),
    summary: z.string(),
    domains: z.array(z.string()).optional(),
    stage: OpportunityStageSchema,
    status: OpportunityStatusSchema.optional(),
    visibility: OpportunityVisibilitySchema,
    headcount: z.number().int().positive(),
    commitmentHoursPerWeek: z.number().int().nullable().optional(),
    location: z.string().nullable().optional(),
    remoteOk: z.boolean().optional(),
    deadline: z.iso.datetime().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    closedAt: z.iso.datetime().nullable().optional(),
    createdAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .strict();

export const OpportunityDetailSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string(),
    organizationSlug: z.string(),
    campusId: z.uuid().nullable(),
    title: z.string(),
    summary: z.string(),
    description: z.string(),
    domains: z.array(z.string()),
    requirements: z.array(z.string()),
    stage: OpportunityStageSchema,
    commitmentHoursPerWeek: z.number().int().nullable(),
    location: z.string().nullable(),
    remoteOk: z.boolean(),
    headcount: z.number().int().positive(),
    deadline: z.iso.datetime().nullable(),
    status: OpportunityStatusSchema,
    visibility: OpportunityVisibilitySchema,
    version: z.number().int().positive(),
    createdBy: z.uuid(),
    contactUserId: z.uuid().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    closedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    isMember: z.boolean(),
  })
  .strict();

export const OpportunityListResponseSchema = z
  .object({
    data: z.array(OpportunitySummarySchema),
  })
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
export const ToolPermissionSchema = z.enum(['memory:read:self', 'memory:write:self']);
export const TOOL_PERMISSIONS = {
  memoryReadSelf: 'memory:read:self',
  memoryWriteSelf: 'memory:write:self',
} as const satisfies Record<string, z.infer<typeof ToolPermissionSchema>>;
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

export const MemoryEventTypeSchema = z.enum([
  'created',
  'candidate_created',
  'confirmed',
  'rejected',
  'updated',
  'expired',
  'deleted',
  'purged',
]);

export const MemoryEventActorTypeSchema = z.enum(['user', 'system']);

export const MemoryEventSchema = z
  .object({
    id: z.uuid(),
    eventType: MemoryEventTypeSchema,
    actorType: MemoryEventActorTypeSchema,
    fromStatus: MemoryStatusSchema.nullable(),
    toStatus: MemoryStatusSchema.nullable(),
    version: z.number().int().positive(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const MemoryEventListResponseSchema = z
  .object({
    data: z.array(MemoryEventSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const AgentRunStatusSchema = z.enum([
  'queued',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
]);

export const AgentRunEventTypeSchema = z.enum([
  'turn.started',
  'message.delta',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'action.proposed',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
]);

export const AgentTurnRequestSchema = z
  .object({
    conversationId: z.uuid().optional(),
    input: z.string().trim().min(1).max(8000),
  })
  .strict();

export const AgentTurnResponseSchema = z
  .object({
    runId: z.uuid(),
    conversationId: z.uuid(),
    status: AgentRunStatusSchema,
    streamUrl: z.string().min(1).max(500),
  })
  .strict();

export const AgentRunSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    status: AgentRunStatusSchema,
    provider: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    inputSummary: z.string().min(1).max(500),
    outputSummary: z.string().max(500).nullable(),
    errorCode: z.string().max(120).nullable(),
    cancelRequestedAt: z.iso.datetime().nullable(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const AgentRunEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.uuid(),
    sequence: z.number().int().positive(),
    eventType: AgentRunEventTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const AgentCancelResponseSchema = z
  .object({
    runId: z.uuid(),
    status: AgentRunStatusSchema,
  })
  .strict();

export const ActionTypeSchema = z.enum(['memory.create']);
export const ActionStatusSchema = z.enum([
  'draft',
  'pending_confirmation',
  'executing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);

export const ActionCreateRequestSchema = z
  .object({
    actionType: ActionTypeSchema,
    payload: CreateMemoryRequestSchema,
    runId: z.uuid().optional(),
    expiresInSeconds: z.number().int().min(1).max(3600).default(600),
  })
  .strict();

export const ActionSchema = z
  .object({
    id: z.uuid(),
    actionType: ActionTypeSchema,
    status: ActionStatusSchema,
    draftVersion: z.number().int().positive(),
    runId: z.uuid().nullable(),
    organizationId: z.uuid().nullable(),
    preview: z.record(z.string(), z.unknown()),
    expiresAt: z.iso.datetime(),
    confirmedAt: z.iso.datetime().nullable(),
    executedAt: z.iso.datetime().nullable(),
    result: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const ActionCreateResponseSchema = ActionSchema.extend({
  confirmationToken: z.string().min(1).max(200),
}).strict();

export const ActionConfirmRequestSchema = z
  .object({
    expectedDraftVersion: z.number().int().min(1),
    confirmationToken: z.string().min(1).max(200),
  })
  .strict();

export const ActionConfirmResponseSchema = ActionSchema;
export const ActionCancelResponseSchema = ActionSchema;

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
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequestSchema>;
export type PublicOrganization = z.infer<typeof PublicOrganizationSchema>;
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;
export type OpportunityVisibility = z.infer<typeof OpportunityVisibilitySchema>;
export type CreateOpportunityDraftRequest = z.infer<typeof CreateOpportunityDraftRequestSchema>;
export type UpdateOpportunityRequest = z.infer<typeof UpdateOpportunityRequestSchema>;
export type OpportunityLifecycleActionRequest = z.infer<
  typeof OpportunityLifecycleActionRequestSchema
>;
export type OpportunitySummary = z.infer<typeof OpportunitySummarySchema>;
export type OpportunityDetail = z.infer<typeof OpportunityDetailSchema>;
export type OpportunityListResponse = z.infer<typeof OpportunityListResponseSchema>;

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
export type MemoryEventType = z.infer<typeof MemoryEventTypeSchema>;
export type MemoryEventActorType = z.infer<typeof MemoryEventActorTypeSchema>;
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;
export type MemoryEventListResponse = z.infer<typeof MemoryEventListResponseSchema>;
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentRunEventType = z.infer<typeof AgentRunEventTypeSchema>;
export type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;
export type AgentTurnResponse = z.infer<typeof AgentTurnResponseSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
export type AgentCancelResponse = z.infer<typeof AgentCancelResponseSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type ActionStatus = z.infer<typeof ActionStatusSchema>;
export type ActionCreateRequest = z.infer<typeof ActionCreateRequestSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type ActionCreateResponse = z.infer<typeof ActionCreateResponseSchema>;
export type ActionConfirmRequest = z.infer<typeof ActionConfirmRequestSchema>;
export type ActionConfirmResponse = z.infer<typeof ActionConfirmResponseSchema>;
export type ActionCancelResponse = z.infer<typeof ActionCancelResponseSchema>;
