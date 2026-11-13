import { z } from 'zod';

export const RequestIdSchema = z.uuid();
export const ApiErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'ACCOUNT_ALREADY_EXISTS',
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
  .object({
    user: AuthUserSchema,
    verificationRequired: z.literal(true),
    verificationDelivery: z.enum(['sent', 'failed']).optional(),
  })
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
export const ToolPermissionSchema = z.enum([
  'memory:read:self',
  'memory:write:self',
  'opportunity:read:org',
  'opportunity:write:org',
  'organization:read:context',
  'plugin:read:catalog',
  'plugin:invoke:maps',
  'plugin:invoke:commerce',
  'plugin:invoke:calendar',
  'plugin:read:mail',
  'plugin:write:mail_draft',
  'plugin:send:mail',
  'plugin:invoke:lifestyle',
  'plugin:invoke:social',
  'plugin:manage:mcp',
  'plugin:invoke:mcp',
]);
export const TOOL_PERMISSIONS = {
  memoryReadSelf: 'memory:read:self',
  memoryWriteSelf: 'memory:write:self',
  opportunityReadOrg: 'opportunity:read:org',
  opportunityWriteOrg: 'opportunity:write:org',
  organizationReadContext: 'organization:read:context',
  pluginReadCatalog: 'plugin:read:catalog',
  pluginInvokeMaps: 'plugin:invoke:maps',
  pluginInvokeCommerce: 'plugin:invoke:commerce',
  pluginInvokeCalendar: 'plugin:invoke:calendar',
  pluginReadMail: 'plugin:read:mail',
  pluginWriteMailDraft: 'plugin:write:mail_draft',
  pluginSendMail: 'plugin:send:mail',
  pluginInvokeLifestyle: 'plugin:invoke:lifestyle',
  pluginInvokeSocial: 'plugin:invoke:social',
  pluginManageMcp: 'plugin:manage:mcp',
  pluginInvokeMcp: 'plugin:invoke:mcp',
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
    organizationId: z.uuid().optional(),
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

export const AgentHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursorCreatedAt: z.iso.datetime({ offset: true }).optional(),
    cursorId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.cursorCreatedAt) === Boolean(value.cursorId));
export const AgentHistoryItemSchema = AgentRunSchema.pick({
  id: true,
  conversationId: true,
  status: true,
  provider: true,
  model: true,
  createdAt: true,
});
export const AgentHistorySchema = z
  .object({
    data: z.array(AgentHistoryItemSchema),
    nextCursor: z
      .object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
      .strict()
      .nullable(),
  })
  .strict();
export type AgentHistoryItem = z.infer<typeof AgentHistoryItemSchema>;
export type AgentHistoryQuery = z.infer<typeof AgentHistoryQuerySchema>;

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

/** Validated flattened wire event carried inside an SSE frame. */
export const AgentStreamEventSchema = z
  .object({
    type: AgentRunEventTypeSchema,
    schema_version: z.literal(1),
    run_id: z.uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    timestamp: z.iso.datetime({ offset: true }),
    text: z.string().max(64000).optional(),
    tool: z.string().max(200).optional(),
    error_code: z.string().max(200).optional(),
  })
  .passthrough()
  .superRefine((event, context) => {
    if (event.type === 'message.delta' && typeof event.text !== 'string')
      context.addIssue({ code: 'custom', path: ['text'], message: 'Delta text is required.' });
  });
export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

export const AgentCancelResponseSchema = z
  .object({
    runId: z.uuid(),
    status: AgentRunStatusSchema,
  })
  .strict();

export const ActionTypeSchema = z.enum(['memory.create', 'opportunity.create']);
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
    organizationId: z.uuid().optional(),
    payload: z.union([CreateMemoryRequestSchema, CreateOpportunityDraftRequestSchema]),
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

// M5: Intents, Matching, Referrals, Consents, and Relationships
export const IntentStatusSchema = z.enum(['draft', 'active', 'paused', 'closed']);

export const CreateIntentRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(10000),
    domains: z.array(z.string().trim().min(1).max(50)).default([]),
    desiredStages: z.array(OpportunityStageSchema).default([]),
    locationPreference: z.string().trim().max(120).nullable().optional(),
    remoteOk: z.boolean().default(false),
    commitmentHoursPerWeek: z.number().int().min(1).max(40).nullable().optional(),
    deadline: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const UpdateIntentRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(10000).optional(),
    domains: z.array(z.string().trim().min(1).max(50)).optional(),
    desiredStages: z.array(OpportunityStageSchema).optional(),
    locationPreference: z.string().trim().max(120).nullable().optional(),
    remoteOk: z.boolean().optional(),
    commitmentHoursPerWeek: z.number().int().min(1).max(40).nullable().optional(),
    deadline: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const SetIntentStatusRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    status: IntentStatusSchema,
  })
  .strict();

export const IntentSchema = z
  .object({
    id: z.uuid(),
    ownerPrincipalId: z.uuid(),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(10000),
    domains: z.array(z.string()),
    desiredStages: z.array(OpportunityStageSchema),
    locationPreference: z.string().nullable(),
    remoteOk: z.boolean(),
    commitmentHoursPerWeek: z.number().nullable(),
    deadline: z.iso.datetime().nullable(),
    status: IntentStatusSchema,
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const IntentListResponseSchema = z
  .object({
    data: z.array(IntentSchema),
  })
  .strict();

export const CandidateStatusSchema = z.enum(['active', 'stale', 'dismissed']);

export const MatchCandidateSchema = z
  .object({
    id: z.uuid(),
    intentId: z.uuid(),
    opportunityId: z.uuid(),
    opportunityTitle: z.string().optional(),
    organizationId: z.uuid().optional(),
    organizationName: z.string().optional(),
    algorithmVersion: z.string().min(1).default('v1'),
    score: z.number().min(0).max(1).nullable(),
    featureScores: z.record(z.string(), z.unknown()),
    reasons: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
    evidence: z.array(z.record(z.string(), z.unknown())),
    status: CandidateStatusSchema,
    computedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const GenerateMatchesRequestSchema = z
  .object({
    algorithmVersion: z.string().trim().min(1).max(64).default('v1'),
  })
  .strict();

export const MatchCandidateListResponseSchema = z
  .object({
    data: z.array(MatchCandidateSchema),
  })
  .strict();

export const ConsentPurposeSchema = z.enum([
  'referral',
  'relationship_context',
  'advisory',
  'event_coordination',
  'connection_invitation',
]);
export const ConsentItemStatusSchema = z.enum(['active', 'revoked', 'expired', 'stale']);

export const CreateConsentPreviewRequestSchema = z
  .object({
    opportunityId: z.uuid(),
    intentId: z.uuid().optional(),
    purposeScopes: z.record(z.string(), z.unknown()).default({
      referral: { fields: ['display_name', 'skills', 'bio'], expiresInDays: 14 },
    }),
  })
  .strict();

export const ConsentPreviewSchema = z
  .object({
    previewId: z.uuid(),
    opportunityId: z.uuid(),
    recipientOrganizationId: z.uuid(),
    recipientOrganizationName: z.string(),
    purposeScopes: z.record(z.string(), z.unknown()),
    previewData: z.record(z.string(), z.unknown()),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const RevokeConsentRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).default('User requested revocation'),
  })
  .strict();

export const ConsentGrantSchema = z
  .object({
    id: z.uuid(),
    grantorPrincipalId: z.uuid(),
    granteePrincipalId: z.uuid(),
    referralId: z.uuid().nullable(),
    purpose: ConsentPurposeSchema,
    status: ConsentItemStatusSchema,
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    revokeReason: z.string().nullable(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const ReferralStatusSchema = z.enum([
  'sent',
  'info_requested',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
]);

export const ReferralSideSchema = z.enum(['applicant', 'organization']);
export const ReferralDecisionTypeSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'info_requested',
]);

export const CreateReferralRequestSchema = z
  .object({
    previewId: z.uuid(),
    candidateId: z.uuid().optional(),
  })
  .strict();

export const ReferralDecisionRequestSchema = z
  .object({
    decision: z.enum(['accepted', 'declined', 'info_requested']),
    reason: z.string().trim().max(1000).optional(),
    expectedVersion: z.number().int().min(1).default(1),
  })
  .strict();

export const WithdrawReferralRequestSchema = z
  .object({
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const ReferralDecisionSchema = z
  .object({
    id: z.uuid(),
    referralId: z.uuid(),
    side: ReferralSideSchema,
    decision: ReferralDecisionTypeSchema,
    reason: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    version: z.number().int().positive(),
  })
  .strict();

export const ReferralSchema = z
  .object({
    id: z.uuid(),
    applicantUserId: z.uuid().optional(),
    applicantName: z.string().optional(),
    intentId: z.uuid().optional(),
    opportunityId: z.uuid().optional(),
    opportunityTitle: z.string().optional(),
    organizationId: z.uuid().optional(),
    organizationName: z.string().optional(),
    candidateId: z.uuid().nullable().optional(),
    status: ReferralStatusSchema,
    contentVersion: z.number().int().positive().optional(),
    version: z.number().int().positive().optional(),
    decisions: z.array(ReferralDecisionSchema).optional(),
    applicantDecision: ReferralDecisionTypeSchema.optional(),
    orgDecision: ReferralDecisionTypeSchema.optional(),
    orgDecisionReason: z.string().nullable().optional(),
    sentAt: z.iso.datetime().optional(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .strict();

export const ReferralListResponseSchema = z
  .object({
    data: z.array(ReferralSchema),
  })
  .strict();

export const ReferralSharedSnapshotResponseSchema = z
  .object({
    referralId: z.uuid(),
    snapshot: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ReferralSupplementSchema = z
  .object({
    id: z.uuid(),
    referralId: z.uuid(),
    supplementVersion: z.number().int().positive(),
    authorUserId: z.uuid(),
    content: z.string().trim().min(1).max(4000),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const SubmitReferralSupplementRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(4000),
    expectedVersion: z.number().int().positive().default(1),
  })
  .strict();

export const ReferralSupplementListResponseSchema = z
  .object({
    referralId: z.uuid(),
    supplements: z.array(ReferralSupplementSchema),
  })
  .strict();

export const RelationshipStatusSchema = z.enum(['active', 'paused', 'completed', 'closed']);
export const RelationshipMemberRoleSchema = z.enum(['applicant', 'organization_lead', 'member']);

export const EstablishRelationshipRequestSchema = z
  .object({
    referralId: z.uuid(),
  })
  .strict();

export const CloseRelationshipRequestSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const RelationshipMemberSchema = z
  .object({
    id: z.uuid(),
    relationshipId: z.uuid(),
    principalId: z.uuid(),
    role: RelationshipMemberRoleSchema,
    joinedAt: z.iso.datetime(),
    leftAt: z.iso.datetime().nullable(),
  })
  .strict();

export const RelationshipSchema = z
  .object({
    id: z.uuid(),
    referralId: z.uuid(),
    applicantUserId: z.uuid(),
    applicantName: z.string().optional(),
    opportunityId: z.uuid(),
    opportunityTitle: z.string().optional(),
    organizationId: z.uuid(),
    status: RelationshipStatusSchema,
    establishedAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
    closedBy: z.uuid().nullable(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const RelationshipListResponseSchema = z
  .object({
    data: z.array(RelationshipSchema),
  })
  .strict();

export const RelationshipContextResponseSchema = z
  .object({
    relationshipId: z.uuid(),
    sharedContext: z.record(z.string(), z.unknown()),
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

export type IntentStatus = z.infer<typeof IntentStatusSchema>;
export type CreateIntentRequest = z.infer<typeof CreateIntentRequestSchema>;
export type UpdateIntentRequest = z.infer<typeof UpdateIntentRequestSchema>;
export type SetIntentStatusRequest = z.infer<typeof SetIntentStatusRequestSchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type IntentListResponse = z.infer<typeof IntentListResponseSchema>;
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;
export type MatchCandidate = z.infer<typeof MatchCandidateSchema>;
export type GenerateMatchesRequest = z.infer<typeof GenerateMatchesRequestSchema>;
export type MatchCandidateListResponse = z.infer<typeof MatchCandidateListResponseSchema>;
export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>;
export type ConsentItemStatus = z.infer<typeof ConsentItemStatusSchema>;
export type CreateConsentPreviewRequest = z.infer<typeof CreateConsentPreviewRequestSchema>;
export type ConsentPreview = z.infer<typeof ConsentPreviewSchema>;
export type RevokeConsentRequest = z.infer<typeof RevokeConsentRequestSchema>;
export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;
export type ReferralStatus = z.infer<typeof ReferralStatusSchema>;
export type ReferralSide = z.infer<typeof ReferralSideSchema>;
export type ReferralDecisionType = z.infer<typeof ReferralDecisionTypeSchema>;
export type CreateReferralRequest = z.infer<typeof CreateReferralRequestSchema>;
export type ReferralDecisionRequest = z.infer<typeof ReferralDecisionRequestSchema>;
export type WithdrawReferralRequest = z.infer<typeof WithdrawReferralRequestSchema>;
export type ReferralDecision = z.infer<typeof ReferralDecisionSchema>;
export type Referral = z.infer<typeof ReferralSchema>;
export type ReferralListResponse = z.infer<typeof ReferralListResponseSchema>;
export type ReferralSharedSnapshotResponse = z.infer<typeof ReferralSharedSnapshotResponseSchema>;
export type ReferralSupplement = z.infer<typeof ReferralSupplementSchema>;
export type SubmitReferralSupplementRequest = z.infer<typeof SubmitReferralSupplementRequestSchema>;
export type ReferralSupplementListResponse = z.infer<typeof ReferralSupplementListResponseSchema>;
export type RelationshipStatus = z.infer<typeof RelationshipStatusSchema>;
export type RelationshipMemberRole = z.infer<typeof RelationshipMemberRoleSchema>;
export type EstablishRelationshipRequest = z.infer<typeof EstablishRelationshipRequestSchema>;
export type CloseRelationshipRequest = z.infer<typeof CloseRelationshipRequestSchema>;
export type RelationshipMember = z.infer<typeof RelationshipMemberSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type RelationshipListResponse = z.infer<typeof RelationshipListResponseSchema>;
export type RelationshipContextResponse = z.infer<typeof RelationshipContextResponseSchema>;

// M6: Calendar, Availability, Events, and Coordination Schemas

export const AvailabilityStatusSchema = z.enum(['busy', 'tentative', 'free']);
export const EventStatusSchema = z.enum([
  'draft',
  'proposed',
  'pending_confirmation',
  'confirmed',
  'cancelled',
  'ended',
]);
export const EventProposalStatusSchema = z.enum(['proposed', 'accepted', 'superseded', 'rejected']);
export const EventParticipantResponseSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'tentative',
]);

export const UpsertAvailabilityBlockRequestSchema = z
  .object({
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string().default('Asia/Shanghai'),
    status: AvailabilityStatusSchema.default('busy'),
    source: z.string().default('manual'),
    blockId: z.uuid().optional(),
  })
  .strict();

export const AvailabilityBlockSchema = z
  .object({
    id: z.uuid(),
    principalId: z.uuid(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string(),
    status: AvailabilityStatusSchema,
    source: z.string(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const AvailabilityBlockListResponseSchema = z
  .object({
    data: z.array(AvailabilityBlockSchema),
  })
  .strict();

export const QueryAvailabilityWindowRequestSchema = z
  .object({
    principalIds: z.array(z.uuid()),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
  })
  .strict();

export const AvailabilityWindowItemSchema = z
  .object({
    principalId: z.uuid(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    status: AvailabilityStatusSchema,
  })
  .strict();

export const AvailabilityWindowResponseSchema = z
  .object({
    data: z.array(AvailabilityWindowItemSchema),
  })
  .strict();

export const AvailabilityShareDirectionSchema = z.enum(['granted', 'received']);

export const CreateAvailabilityShareRequestSchema = z
  .object({
    granteePrincipalId: z.uuid(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const AvailabilityShareSchema = z
  .object({
    id: z.uuid(),
    grantorPrincipalId: z.uuid(),
    granteePrincipalId: z.uuid(),
    purpose: z.literal('event_coordination'),
    status: z.enum(['active', 'revoked', 'expired']),
    expiresAt: z.iso.datetime(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    direction: AvailabilityShareDirectionSchema,
  })
  .strict();

export const AvailabilityShareListResponseSchema = z
  .object({
    data: z.array(AvailabilityShareSchema),
  })
  .strict();

export const CreateEventDraftRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(10000).optional(),
    location: z.string().trim().max(255).optional(),
    startAt: z.iso.datetime().optional(),
    endAt: z.iso.datetime().optional(),
    timezone: z.string().default('Asia/Shanghai'),
    relationshipId: z.uuid().optional(),
    organizationId: z.uuid().optional(),
    attendeePrincipalIds: z.array(z.uuid()).default([]),
  })
  .strict();

export const ProposeEventTimeRequestSchema = z
  .object({
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string().default('Asia/Shanghai'),
    expectedVersion: z.number().int().positive().default(1),
  })
  .strict();

export const RespondEventParticipantRequestSchema = z
  .object({
    response: EventParticipantResponseSchema,
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const CancelEventRequestSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const EventParticipantSchema = z
  .object({
    id: z.uuid().optional(),
    eventId: z.uuid().optional(),
    principalId: z.uuid(),
    role: z.string(),
    response: EventParticipantResponseSchema,
    respondedAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const EventProposalSchema = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    version: z.number().int().positive(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string(),
    status: EventProposalStatusSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

export const EventSchema = z
  .object({
    id: z.uuid(),
    organizerPrincipalId: z.uuid(),
    organizerName: z.string().optional(),
    relationshipId: z.uuid().nullable().optional(),
    organizationId: z.uuid().nullable().optional(),
    title: z.string(),
    description: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string(),
    status: EventStatusSchema,
    version: z.number().int().positive(),
    myResponse: EventParticipantResponseSchema.optional(),
    participants: z.array(EventParticipantSchema).optional(),
    createdAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .strict();

export const EventListResponseSchema = z
  .object({
    data: z.array(EventSchema),
  })
  .strict();

export const TimeSlotSchema = z
  .object({
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
  })
  .strict();

export const TimeIntersectionRequestSchema = z
  .object({
    principalIds: z.array(z.uuid()).min(1).max(50),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(31 * 24 * 60)
      .default(60),
    workingHoursOnly: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) => {
      const windowMs = Date.parse(value.windowEnd) - Date.parse(value.windowStart);
      return windowMs > 0 && windowMs <= 31 * 24 * 60 * 60 * 1000;
    },
    { message: 'Window must be positive and no longer than 31 days.', path: ['windowEnd'] },
  );

export const TimeIntersectionResponseSchema = z
  .object({
    availableSlots: z.array(TimeSlotSchema),
  })
  .strict();

export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;
export type EventStatus = z.infer<typeof EventStatusSchema>;
export type EventProposalStatus = z.infer<typeof EventProposalStatusSchema>;
export type EventParticipantResponse = z.infer<typeof EventParticipantResponseSchema>;
export type UpsertAvailabilityBlockRequest = z.infer<typeof UpsertAvailabilityBlockRequestSchema>;
export type AvailabilityBlock = z.infer<typeof AvailabilityBlockSchema>;
export type AvailabilityBlockListResponse = z.infer<typeof AvailabilityBlockListResponseSchema>;
export type QueryAvailabilityWindowRequest = z.infer<typeof QueryAvailabilityWindowRequestSchema>;
export type AvailabilityWindowItem = z.infer<typeof AvailabilityWindowItemSchema>;
export type AvailabilityWindowResponse = z.infer<typeof AvailabilityWindowResponseSchema>;
export type AvailabilityShareDirection = z.infer<typeof AvailabilityShareDirectionSchema>;
export type CreateAvailabilityShareRequest = z.infer<typeof CreateAvailabilityShareRequestSchema>;
export type AvailabilityShare = z.infer<typeof AvailabilityShareSchema>;
export type AvailabilityShareListResponse = z.infer<typeof AvailabilityShareListResponseSchema>;
export type CreateEventDraftRequest = z.infer<typeof CreateEventDraftRequestSchema>;
export type ProposeEventTimeRequest = z.infer<typeof ProposeEventTimeRequestSchema>;
export type RespondEventParticipantRequest = z.infer<typeof RespondEventParticipantRequestSchema>;
export type CancelEventRequest = z.infer<typeof CancelEventRequestSchema>;
export type EventParticipant = z.infer<typeof EventParticipantSchema>;
export type EventProposal = z.infer<typeof EventProposalSchema>;
export type Event = z.infer<typeof EventSchema>;
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
export type TimeSlot = z.infer<typeof TimeSlotSchema>;
export type TimeIntersectionRequest = z.infer<typeof TimeIntersectionRequestSchema>;
export type TimeIntersectionResponse = z.infer<typeof TimeIntersectionResponseSchema>;

export const UserAIProviderInputSchema = z
  .object({
    baseUrl: z.url().max(2048),
    model: z.string().trim().min(1).max(120),
    apiKey: z.string().min(1).max(500),
    expectedVersion: z.number().int().min(0).max(2147483646),
  })
  .strict();
export const UserAIProviderMetadataSchema = z
  .object({
    baseUrl: z.string(),
    model: z.string(),
    version: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type UserAIProviderInput = z.infer<typeof UserAIProviderInputSchema>;
export type UserAIProviderMetadata = z.infer<typeof UserAIProviderMetadataSchema>;

const UniqueMemoryIds = z
  .array(z.uuid())
  .min(1)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length);
export const CreateConnectionPreviewRequestSchema = z
  .object({
    recipientUserId: z.uuid(),
    memoryItemIds: UniqueMemoryIds,
    expiresInDays: z.number().int().min(1).max(7).default(7),
  })
  .strict();
export const SendConnectionInvitationRequestSchema = z.object({ previewId: z.uuid() }).strict();
export const ConnectionDecisionRequestSchema = z
  .object({
    decision: z.enum(['accepted', 'declined']),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const ConnectionWithdrawRequestSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const ConnectionPreviewSchema = z
  .object({
    id: z.uuid(),
    recipientUserId: z.uuid(),
    purpose: z.literal('connection_invitation'),
    snapshot: z.array(
      z
        .object({
          sourceId: z.uuid(),
          value: z.string(),
          sourceVersion: z.number().int().positive(),
          policyVersion: z.number().int().positive(),
          validUntil: z.iso.datetime({ offset: true }).nullable(),
        })
        .strict(),
    ),
    grantExpiresAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const ConnectionInvitationSchema = z
  .object({
    id: z.uuid(),
    senderUserId: z.uuid(),
    recipientUserId: z.uuid(),
    status: z.enum(['pending', 'accepted', 'declined', 'withdrawn', 'expired']),
    version: z.number().int().positive(),
    grantId: z.uuid(),
    grantStatus: z.enum(['active', 'revoked', 'expired']),
    senderConfirmedAt: z.iso.datetime({ offset: true }),
    recipientDecidedAt: z.iso.datetime({ offset: true }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }),
    createdAt: z.iso.datetime({ offset: true }),
    connectionId: z.uuid().nullable(),
  })
  .strict();
export const ConnectionInvitationListSchema = z
  .object({ data: z.array(ConnectionInvitationSchema) })
  .strict();
export const ConnectionSnapshotSchema = z
  .object({
    invitationId: z.uuid(),
    items: z.array(
      z
        .object({
          sourceId: z.uuid(),
          field: z.literal('content'),
          value: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export const PeerConnectionSchema = z
  .object({
    id: z.uuid(),
    userLow: z.uuid(),
    userHigh: z.uuid(),
    invitationId: z.uuid(),
    establishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const PeerConnectionListSchema = z.object({ data: z.array(PeerConnectionSchema) }).strict();
export type CreateConnectionPreviewRequest = z.infer<typeof CreateConnectionPreviewRequestSchema>;
export type ConnectionInvitation = z.infer<typeof ConnectionInvitationSchema>;

export const ConnectionWidgetSchema = z
  .object({
    kind: z.literal('connection_invitation'),
    role: z.enum(['sender', 'recipient']),
    invitation: ConnectionInvitationSchema,
    snapshot: ConnectionSnapshotSchema,
  })
  .strict()
  .refine((widget) => widget.invitation.id === widget.snapshot.invitationId);
export type ConnectionWidget = z.infer<typeof ConnectionWidgetSchema>;

export const ConnectionMaintenanceBatchSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(100);
export const ConnectionMaintenanceResultSchema = z
  .object({
    previewsPurged: z.number().int().min(0).max(1000),
    itemsInvalidated: z.number().int().min(0).max(1000),
    snapshotsPurged: z.number().int().min(0).max(1000),
  })
  .strict();

export const SendPeerMessageRequestSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, 'content must not be empty')
      .max(4000, 'content must not exceed 4000 characters'),
    clientMessageId: z.uuid(),
  })
  .strict();
export type SendPeerMessageRequest = z.infer<typeof SendPeerMessageRequestSchema>;

export const PeerMessageSchema = z
  .object({
    id: z.uuid(),
    connectionId: z.uuid(),
    senderUserId: z.uuid(),
    content: z.string(),
    clientMessageId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type PeerMessage = z.infer<typeof PeerMessageSchema>;

export const ListPeerMessagesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursorCreatedAt: z.iso.datetime({ offset: true }).optional(),
    cursorId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (q) =>
      (q.cursorCreatedAt === undefined && q.cursorId === undefined) ||
      (q.cursorCreatedAt !== undefined && q.cursorId !== undefined),
    { message: 'cursorCreatedAt and cursorId must be provided together' },
  );
export type ListPeerMessagesQuery = z.infer<typeof ListPeerMessagesQuerySchema>;

export const PeerMessageCursorSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();
export type PeerMessageCursor = z.infer<typeof PeerMessageCursorSchema>;

export const ListPeerMessagesResponseSchema = z
  .object({
    connectionId: z.uuid(),
    messages: z.array(PeerMessageSchema),
    nextCursor: PeerMessageCursorSchema.nullable(),
  })
  .strict();
export type ListPeerMessagesResponse = z.infer<typeof ListPeerMessagesResponseSchema>;

export const DeletePeerMessageResponseSchema = z
  .object({
    success: z.literal(true),
    messageId: z.uuid(),
  })
  .strict();
export type DeletePeerMessageResponse = z.infer<typeof DeletePeerMessageResponseSchema>;

export const NotificationKindSchema = z.enum([
  'sent',
  'accepted',
  'declined',
  'withdrawn',
  'revoked',
  'proposed',
  'confirmed',
  'cancelled',
]);
export const NotificationTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connection_invitation'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('event'), id: z.uuid() }).strict(),
]);
export const NotificationSchema = z
  .object({
    id: z.uuid(),
    kind: NotificationKindSchema,
    target: NotificationTargetSchema,
    createdAt: z.iso.datetime({ offset: true }),
    readAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export const NotificationCursorSchema = z
  .object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
  .strict();
export const NotificationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursorCreatedAt: z.iso.datetime({ offset: true }).optional(),
    cursorId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.cursorCreatedAt) === Boolean(value.cursorId));
export const NotificationListSchema = z
  .object({
    data: z.array(NotificationSchema),
    nextCursor: NotificationCursorSchema.nullable(),
    unreadCount: z.number().int().nonnegative(),
  })
  .strict();
export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationCursor = z.infer<typeof NotificationCursorSchema>;
export const NotificationPreferencesSchema = z
  .object({
    connectionInvitations: z.boolean(),
    connectionUpdates: z.boolean(),
    eventInvitations: z.boolean().default(true),
    eventUpdates: z.boolean().default(true),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const UpdateNotificationPreferencesSchema = z
  .object({
    connectionInvitations: z.boolean().optional(),
    connectionUpdates: z.boolean().optional(),
    eventInvitations: z.boolean().optional(),
    eventUpdates: z.boolean().optional(),
    expectedVersion: z.number().int().min(0).max(2147483646),
  })
  .strict();
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesSchema
>;
export const RetryNotificationSchema = z
  .object({ expectedGeneration: z.number().int().min(0).max(2147483646) })
  .strict();
export const NotificationRetryResultSchema = z
  .object({ id: z.uuid(), generation: z.number().int().positive(), status: z.literal('pending') })
  .strict();
export const NotificationDeadListSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.uuid(),
          kind: NotificationKindSchema,
          generation: z.number().int().nonnegative(),
          attempts: z.literal(5),
          errorCode: z.literal('DELIVERY_FAILED'),
          createdAt: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
  })
  .strict();

export const NotificationMaintenanceBatchSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(100);

// --- Blocks ---
export const BlockUserRequestSchema = z
  .object({
    blockedUserId: z.uuid(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type BlockUserRequest = z.infer<typeof BlockUserRequestSchema>;

export const BlockItemSchema = z
  .object({
    id: z.uuid(),
    blockedUserId: z.uuid(),
    reason: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .strict();
export type BlockItem = z.infer<typeof BlockItemSchema>;

export const BlockUserResponseSchema = z
  .object({
    id: z.uuid(),
    ownerUserId: z.uuid(),
    blockedUserId: z.uuid(),
    reason: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type BlockUserResponse = z.infer<typeof BlockUserResponseSchema>;

export const UnblockUserResponseSchema = z
  .object({
    unblocked: z.boolean(),
  })
  .strict();
export type UnblockUserResponse = z.infer<typeof UnblockUserResponseSchema>;

export const ListBlocksResponseSchema = z
  .object({
    blocks: z.array(BlockItemSchema),
  })
  .strict();
export type ListBlocksResponse = z.infer<typeof ListBlocksResponseSchema>;

// --- Reports ---
export const ReportTargetTypeSchema = z.enum([
  'user',
  'peer_message',
  'connection_invitation',
  'event',
]);
export type ReportTargetType = z.infer<typeof ReportTargetTypeSchema>;

export const ReportReasonSchema = z.enum([
  'spam',
  'harassment',
  'inappropriate_content',
  'privacy_violation',
  'other',
]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const ReportStatusSchema = z.enum(['open', 'reviewing', 'resolved', 'dismissed']);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const SubmitReportRequestSchema = z
  .object({
    targetType: ReportTargetTypeSchema,
    targetId: z.uuid(),
    reason: ReportReasonSchema,
    details: z.string().trim().max(1000).optional(),
  })
  .strict();
export type SubmitReportRequest = z.infer<typeof SubmitReportRequestSchema>;

export const ReportItemSchema = z
  .object({
    id: z.uuid(),
    targetType: ReportTargetTypeSchema,
    targetId: z.uuid(),
    reason: ReportReasonSchema,
    details: z.string().nullable().optional(),
    status: ReportStatusSchema,
    createdAt: z.string(),
  })
  .strict();
export type ReportItem = z.infer<typeof ReportItemSchema>;

export const SubmitReportResponseSchema = z
  .object({
    id: z.uuid(),
    reporterUserId: z.uuid(),
    targetType: ReportTargetTypeSchema,
    targetId: z.uuid(),
    reason: ReportReasonSchema,
    details: z.string().nullable(),
    status: ReportStatusSchema,
    createdAt: z.string(),
  })
  .strict();
export type SubmitReportResponse = z.infer<typeof SubmitReportResponseSchema>;

export const ListReportsResponseSchema = z
  .object({
    reports: z.array(ReportItemSchema),
  })
  .strict();
export type ListReportsResponse = z.infer<typeof ListReportsResponseSchema>;

// --- M6-05: AI Event Constraint Extraction & Coordination ---

function isValidTimeZoneName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export const IanaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZoneName, { message: 'Invalid IANA time zone.' });

export const PreferredTimeOfDaySchema = z.enum(['morning', 'afternoon', 'evening', 'any']);
export type PreferredTimeOfDay = z.infer<typeof PreferredTimeOfDaySchema>;

export const WorkingHoursWindowSchema = z
  .object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((value) => value.startHour < value.endHour, {
    message: 'startHour must be strictly before endHour.',
    path: ['endHour'],
  });
export type WorkingHoursWindow = z.infer<typeof WorkingHoursWindowSchema>;

export const MissingCoordinationConstraintSchema = z.enum([
  'windowStart',
  'windowEnd',
  'durationMinutes',
]);
export type MissingCoordinationConstraint = z.infer<typeof MissingCoordinationConstraintSchema>;

export const EventCoordinationStatusSchema = z.enum([
  'candidates_ready',
  'needs_clarification',
  'no_common_slots',
]);
export type EventCoordinationStatus = z.infer<typeof EventCoordinationStatusSchema>;

export const ExtractedEventConstraintsSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable(),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(31 * 24 * 60)
      .nullable(),
    windowStart: z.iso.datetime().nullable(),
    windowEnd: z.iso.datetime().nullable(),
    timezone: IanaTimeZoneSchema.nullable(),
    workingHoursOnly: z.boolean().nullable(),
    workingHours: WorkingHoursWindowSchema.nullable(),
    preferredTimeOfDay: PreferredTimeOfDaySchema.default('any'),
    notes: z.string().trim().max(500).nullable(),
  })
  .strict();
export type ExtractedEventConstraints = z.infer<typeof ExtractedEventConstraintsSchema>;

export const EventCoordinationOverridesSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(31 * 24 * 60)
      .optional(),
    windowStart: z.iso.datetime().optional(),
    windowEnd: z.iso.datetime().optional(),
    timezone: IanaTimeZoneSchema.optional(),
    workingHoursOnly: z.boolean().optional(),
    workingHours: WorkingHoursWindowSchema.optional(),
    preferredTimeOfDay: PreferredTimeOfDaySchema.optional(),
  })
  .strict()
  .refine(
    (value) => {
      if (!value.windowStart || !value.windowEnd) return true;
      const diff = Date.parse(value.windowEnd) - Date.parse(value.windowStart);
      return diff > 0 && diff <= 31 * 24 * 60 * 60 * 1000;
    },
    { message: 'Window must be positive and no longer than 31 days.', path: ['windowEnd'] },
  );
export type EventCoordinationOverrides = z.infer<typeof EventCoordinationOverridesSchema>;

export const CoordinateEventRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    participantIds: z.array(z.uuid()).min(1).max(50),
    referenceNow: z.iso.datetime().optional(),
    defaultTimezone: IanaTimeZoneSchema.default('Asia/Shanghai'),
    participantTimezones: z.record(z.uuid(), IanaTimeZoneSchema).optional(),
    overrides: EventCoordinationOverridesSchema.optional(),
    maxCandidates: z.number().int().min(1).max(50).default(10),
  })
  .strict()
  .refine(
    (value) => {
      if (!value.participantTimezones) return true;
      const allowed = new Set(value.participantIds);
      return Object.keys(value.participantTimezones).every((id) => allowed.has(id));
    },
    {
      message: 'participantTimezones keys must belong to participantIds.',
      path: ['participantTimezones'],
    },
  );
export type CoordinateEventRequest = z.infer<typeof CoordinateEventRequestSchema>;

export const CoordinationCandidateSlotSchema = z
  .object({
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    score: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();
export type CoordinationCandidateSlot = z.infer<typeof CoordinationCandidateSlotSchema>;

export const CoordinateEventResponseSchema = z
  .object({
    status: EventCoordinationStatusSchema,
    provider: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    mock: z.boolean(),
    extractedConstraints: ExtractedEventConstraintsSchema,
    missingConstraints: z.array(MissingCoordinationConstraintSchema),
    clarificationPrompts: z.array(z.string().trim().min(1).max(300)),
    candidates: z.array(CoordinationCandidateSlotSchema),
    externalCalendarsModified: z.literal(false),
  })
  .strict();
export type CoordinateEventResponse = z.infer<typeof CoordinateEventResponseSchema>;

// =============================================================================
// Extensible Plugins & Conversational Functional Widgets
// =============================================================================

export const PluginCategorySchema = z.enum([
  'maps',
  'commerce',
  'mail',
  'lifestyle',
  'calendar',
  'social',
  'productivity',
  'mcp',
]);
export type PluginCategory = z.infer<typeof PluginCategorySchema>;

export const PluginAuthTypeSchema = z.enum(['none', 'api_key', 'oauth2']);
export type PluginAuthType = z.infer<typeof PluginAuthTypeSchema>;

export const PluginCredentialStatusSchema = z.enum([
  'mock_only',
  'configured',
  'missing_credentials',
]);
export type PluginCredentialStatus = z.infer<typeof PluginCredentialStatusSchema>;

export const PluginProviderModeSchema = z.enum(['mock', 'live']);
export type PluginProviderMode = z.infer<typeof PluginProviderModeSchema>;

export const ConversationWidgetKindSchema = z.enum([
  'map_location_card',
  'product_comparison_card',
  'schedule_candidates_card',
  'action_preview_card',
  'email_thread_list_card',
  'email_compose_preview_card',
  'instant_delivery_card',
  'local_merchant_card',
  'social_connection_card',
  'cross_platform_compare_card',
  'weather_travel_card',
  'mcp_result_card',
]);
export type ConversationWidgetKind = z.infer<typeof ConversationWidgetKindSchema>;

const PRIVATE_HOSTNAME_PATTERN =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[?(::1|fe[89ab][0-9a-f]:.*|fc[0-9a-f]{2}:.*|fd[0-9a-f]{2}:.*)\]?)$/i;

const SAFE_HTTPS_HOST_PATTERN =
  /^https:\/\/(?![^/?#]*@)([^:/?#[\]]+|\[[^\]]+\])(?::\d{1,5})?(?:[/?#].*)?$/i;

export const SafeHttpsUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine(
    (raw) => {
      const match = SAFE_HTTPS_HOST_PATTERN.exec(raw);
      const hostname = match?.[1];
      if (!hostname) return false;
      if (PRIVATE_HOSTNAME_PATTERN.test(hostname)) return false;
      return true;
    },
    { message: 'URL must be a public https:// URL without embedded credentials.' },
  );

export const PluginIdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,64}$/);
export const PluginActionNameSchema = z.string().regex(/^[a-z][a-z0-9_]{1,48}$/);

export const MapLocationItemSchema = z
  .object({
    poiId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    formattedAddress: z.string().trim().min(1).max(300),
    province: z.string().trim().min(1).max(80).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    district: z.string().trim().min(1).max(80).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    distanceMeters: z.number().int().min(0).max(1_000_000).optional(),
    navigationUrl: SafeHttpsUrlSchema.optional(),
  })
  .strict();
export type MapLocationItem = z.infer<typeof MapLocationItemSchema>;

export const MapLocationWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('map_location_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    subtitle: z.string().trim().min(1).max(240).optional(),
    query: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(80).optional(),
    providerMode: PluginProviderModeSchema,
    sourceAttribution: z.string().trim().min(1).max(120),
    locations: z.array(MapLocationItemSchema).min(1).max(10),
  })
  .strict();
export type MapLocationWidget = z.infer<typeof MapLocationWidgetSchema>;

export const ProductOfferItemSchema = z
  .object({
    itemId: z.string().trim().min(1).max(120),
    platform: z.enum(['taobao', 'jd', 'other']),
    title: z.string().trim().min(1).max(200),
    shopName: z.string().trim().min(1).max(120),
    priceCents: z.number().int().min(0).max(1_000_000_000),
    originalPriceCents: z.number().int().min(0).max(1_000_000_000).optional(),
    currency: z.literal('CNY').default('CNY'),
    tags: z.array(z.string().trim().min(1).max(32)).max(6).default([]),
    rating: z.number().min(0).max(5).optional(),
    monthlySalesHint: z.string().trim().min(1).max(40).optional(),
    productUrl: SafeHttpsUrlSchema,
  })
  .strict();
export type ProductOfferItem = z.infer<typeof ProductOfferItemSchema>;

export const ProductComparisonWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('product_comparison_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    subtitle: z.string().trim().min(1).max(240).optional(),
    query: z.string().trim().min(1).max(200),
    platformLabel: z.string().trim().min(1).max(80),
    providerMode: PluginProviderModeSchema,
    requiresUserConfirmationBeforeJump: z.literal(true),
    items: z.array(ProductOfferItemSchema).min(1).max(10),
  })
  .strict();
export type ProductComparisonWidget = z.infer<typeof ProductComparisonWidgetSchema>;

export const ScheduleCandidatesWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('schedule_candidates_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    status: EventCoordinationStatusSchema,
    timezone: IanaTimeZoneSchema,
    providerMode: PluginProviderModeSchema,
    clarificationPrompts: z.array(z.string().trim().min(1).max(300)).max(10),
    candidates: z.array(CoordinationCandidateSlotSchema).max(10),
    externalCalendarsModified: z.literal(false),
  })
  .strict();
export type ScheduleCandidatesWidget = z.infer<typeof ScheduleCandidatesWidgetSchema>;

export const ActionPreviewWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('action_preview_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(400),
    actionLabel: z.string().trim().min(1).max(60),
    targetUrl: SafeHttpsUrlSchema.optional(),
    requiresConfirmation: z.literal(true),
    providerMode: PluginProviderModeSchema,
  })
  .strict();
export type ActionPreviewWidget = z.infer<typeof ActionPreviewWidgetSchema>;

export const EmailThreadSummarySchema = z
  .object({
    threadId: z.string().trim().min(1).max(120),
    fromLabel: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(200),
    snippet: z.string().trim().min(1).max(320),
    receivedAt: z.iso.datetime(),
    unread: z.boolean(),
    hasAttachments: z.boolean().default(false),
  })
  .strict();
export type EmailThreadSummary = z.infer<typeof EmailThreadSummarySchema>;

export const EmailThreadListWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('email_thread_list_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    mailboxProvider: z.enum(['gmail', 'qqmail', 'other']),
    query: z.string().trim().min(1).max(200),
    providerMode: PluginProviderModeSchema,
    threads: z.array(EmailThreadSummarySchema).max(10),
  })
  .strict();
export type EmailThreadListWidget = z.infer<typeof EmailThreadListWidgetSchema>;

export const EmailComposePreviewWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('email_compose_preview_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    draftId: z.string().trim().min(1).max(120),
    mailboxProvider: z.enum(['gmail', 'qqmail', 'other']),
    to: z.array(z.string().trim().min(3).max(160)).min(1).max(10),
    cc: z.array(z.string().trim().min(3).max(160)).max(10).default([]),
    subject: z.string().trim().min(1).max(200),
    bodyPreview: z.string().trim().min(1).max(2000),
    status: z.enum(['draft_preview', 'sent']),
    requiresUserConfirmation: z.boolean(),
    providerMode: PluginProviderModeSchema,
  })
  .strict();
export type EmailComposePreviewWidget = z.infer<typeof EmailComposePreviewWidgetSchema>;

export const InstantDeliveryItemSchema = z
  .object({
    itemId: z.string().trim().min(1).max(120),
    platform: z.enum(['taobao_flash', 'meituan']),
    storeName: z.string().trim().min(1).max(140),
    productTitle: z.string().trim().min(1).max(200),
    priceCents: z.number().int().min(0).max(1_000_000_000),
    deliveryFeeCents: z.number().int().min(0).max(100_000),
    minOrderCents: z.number().int().min(0).max(100_000),
    etaMinutes: z.number().int().min(1).max(360),
    distanceMeters: z.number().int().min(0).max(100_000),
    tags: z.array(z.string().trim().min(1).max(32)).max(6).default([]),
    orderUrl: SafeHttpsUrlSchema,
  })
  .strict();
export type InstantDeliveryItem = z.infer<typeof InstantDeliveryItemSchema>;

export const InstantDeliveryWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('instant_delivery_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    query: z.string().trim().min(1).max(200),
    deliveryAddress: z.string().trim().min(1).max(200),
    providerMode: PluginProviderModeSchema,
    requiresUserConfirmationBeforeJump: z.literal(true),
    items: z.array(InstantDeliveryItemSchema).min(1).max(10),
  })
  .strict();
export type InstantDeliveryWidget = z.infer<typeof InstantDeliveryWidgetSchema>;

export const LocalMerchantItemSchema = z
  .object({
    merchantId: z.string().trim().min(1).max(120),
    platform: z.enum(['meituan', 'other']),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(80),
    address: z.string().trim().min(1).max(240),
    rating: z.number().min(0).max(5),
    avgPriceCents: z.number().int().min(0).max(1_000_000),
    dealTitle: z.string().trim().min(1).max(160).optional(),
    dealPriceCents: z.number().int().min(0).max(1_000_000).optional(),
    openStatus: z.string().trim().min(1).max(60),
    merchantUrl: SafeHttpsUrlSchema,
  })
  .strict();
export type LocalMerchantItem = z.infer<typeof LocalMerchantItemSchema>;

export const LocalMerchantWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('local_merchant_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    query: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(80).optional(),
    providerMode: PluginProviderModeSchema,
    requiresUserConfirmationBeforeJump: z.literal(true),
    merchants: z.array(LocalMerchantItemSchema).min(1).max(10),
  })
  .strict();
export type LocalMerchantWidget = z.infer<typeof LocalMerchantWidgetSchema>;

export const SocialConnectionWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('social_connection_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    mode: z.enum(['suggestion_preview', 'invitation_status']),
    targetUserId: z.uuid(),
    displayName: z.string().trim().min(1).max(120),
    headline: z.string().trim().min(1).max(240),
    matchReason: z.string().trim().min(1).max(240),
    purpose: z.literal('connection_invitation'),
    status: z.enum(['preview', 'pending', 'accepted', 'declined', 'revoked']),
    selectedFields: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
    expiresInDays: z.number().int().min(1).max(30),
    privacyNotice: z.string().trim().min(1).max(240),
    providerMode: PluginProviderModeSchema,
  })
  .strict();
export type SocialConnectionWidget = z.infer<typeof SocialConnectionWidgetSchema>;

export const CrossPlatformOfferItemSchema = z
  .object({
    platform: z.enum(['taobao', 'jd', 'taobao_flash', 'meituan', 'other']),
    platformLabel: z.string().trim().min(1).max(60),
    itemId: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    shopOrStoreName: z.string().trim().min(1).max(140),
    priceCents: z.number().int().min(0).max(1_000_000_000),
    fulfillmentHint: z.string().trim().min(1).max(80),
    rating: z.number().min(0).max(5).optional(),
    targetUrl: SafeHttpsUrlSchema,
  })
  .strict();
export type CrossPlatformOfferItem = z.infer<typeof CrossPlatformOfferItemSchema>;

export const CrossPlatformCompareWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('cross_platform_compare_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    query: z.string().trim().min(1).max(200),
    bestPricePlatformLabel: z.string().trim().min(1).max(80),
    fastestDeliveryPlatformLabel: z.string().trim().min(1).max(80),
    providerMode: PluginProviderModeSchema,
    requiresUserConfirmationBeforeJump: z.literal(true),
    items: z.array(CrossPlatformOfferItemSchema).min(1).max(15),
  })
  .strict();
export type CrossPlatformCompareWidget = z.infer<typeof CrossPlatformCompareWidgetSchema>;

export const WeatherTravelWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('weather_travel_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    city: z.string().trim().min(1).max(80),
    dateLabel: z.string().trim().min(1).max(40),
    condition: z.string().trim().min(1).max(60),
    tempMinC: z.number().min(-60).max(60),
    tempMaxC: z.number().min(-60).max(60),
    commuteAdvice: z.string().trim().min(1).max(240),
    providerMode: PluginProviderModeSchema,
  })
  .strict();
export type WeatherTravelWidget = z.infer<typeof WeatherTravelWidgetSchema>;

export const McpResultRowSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().max(500),
  })
  .strict();

export const McpResultWidgetSchema = z
  .object({
    widgetId: z.string().trim().min(1).max(120),
    kind: z.literal('mcp_result_card'),
    pluginId: PluginIdSchema,
    title: z.string().trim().min(1).max(160),
    serverId: z.string().trim().min(1).max(120),
    serverName: z.string().trim().min(1).max(80),
    toolName: z.string().trim().min(1).max(80),
    displayMode: z.enum(['key_value', 'summary']),
    summaryText: z.string().trim().min(1).max(1000),
    rows: z.array(McpResultRowSchema).max(25),
    readOnly: z.boolean(),
    externalNotice: z.string().trim().min(1).max(200),
    providerMode: PluginProviderModeSchema,
  })
  .strict();
export type McpResultWidget = z.infer<typeof McpResultWidgetSchema>;

export const ConversationWidgetSchema = z.discriminatedUnion('kind', [
  MapLocationWidgetSchema,
  ProductComparisonWidgetSchema,
  ScheduleCandidatesWidgetSchema,
  ActionPreviewWidgetSchema,
  EmailThreadListWidgetSchema,
  EmailComposePreviewWidgetSchema,
  InstantDeliveryWidgetSchema,
  LocalMerchantWidgetSchema,
  SocialConnectionWidgetSchema,
  CrossPlatformCompareWidgetSchema,
  WeatherTravelWidgetSchema,
  McpResultWidgetSchema,
]);
export type ConversationWidget = z.infer<typeof ConversationWidgetSchema>;

export const PluginActionManifestSchema = z
  .object({
    name: PluginActionNameSchema,
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    requiredPermissions: z.array(ToolPermissionSchema).min(1).max(8),
    widgetKinds: z.array(ConversationWidgetKindSchema).min(1).max(4),
    idempotent: z.boolean(),
    timeoutMs: z.number().int().min(100).max(60_000),
    maxRetries: z.number().int().min(0).max(5),
    inputJsonSchema: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PluginActionManifest = z.infer<typeof PluginActionManifestSchema>;

export const PluginManifestSchema = z
  .object({
    id: PluginIdSchema,
    name: z.string().trim().min(1).max(80),
    providerName: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(400),
    version: z.string().trim().min(1).max(32),
    category: PluginCategorySchema,
    authType: PluginAuthTypeSchema,
    credentialStatus: PluginCredentialStatusSchema,
    allowedExternalHosts: z.array(z.string().trim().min(1).max(120)).max(20),
    supportsLiveAdapter: z.boolean(),
    readOnly: z.boolean(),
    actions: z.array(PluginActionManifestSchema).min(1).max(20),
  })
  .strict();
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const PluginCatalogResponseSchema = z
  .object({
    plugins: z.array(PluginManifestSchema).max(100),
    total: z.number().int().min(0).max(100),
  })
  .strict();
export type PluginCatalogResponse = z.infer<typeof PluginCatalogResponseSchema>;

export const PluginInvokeRequestSchema = z
  .object({
    action: PluginActionNameSchema,
    input: z.record(z.string(), z.unknown()),
    conversationId: z.uuid().optional(),
    allowLive: z.boolean().default(false),
  })
  .strict();
export type PluginInvokeRequest = z.infer<typeof PluginInvokeRequestSchema>;

export const PluginInvokeResponseSchema = z
  .object({
    invocationId: z.uuid(),
    pluginId: PluginIdSchema,
    action: PluginActionNameSchema,
    providerMode: PluginProviderModeSchema,
    summary: z.string().trim().min(1).max(500),
    data: z.record(z.string(), z.unknown()),
    widgets: z.array(ConversationWidgetSchema).max(10),
    auditRef: z.string().trim().min(1).max(120),
    executedAt: z.iso.datetime(),
  })
  .strict();
export type PluginInvokeResponse = z.infer<typeof PluginInvokeResponseSchema>;

export const McpAuthTypeSchema = z.enum(['none', 'bearer', 'api_key_header']);
export type McpAuthType = z.infer<typeof McpAuthTypeSchema>;

export const McpDiscoveredToolSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    readOnly: z.boolean().default(true),
    inputJsonSchema: z.record(z.string(), z.unknown()),
  })
  .strict();
export type McpDiscoveredTool = z.infer<typeof McpDiscoveredToolSchema>;

export const McpServerConfigCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    endpointUrl: SafeHttpsUrlSchema,
    authType: McpAuthTypeSchema.default('none'),
    headerName: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9-]{1,60}$/)
      .optional(),
    credentialSecret: z.string().min(1).max(500).optional(),
    allowedTools: z
      .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/))
      .max(50)
      .optional(),
    timeoutMs: z.number().int().min(500).max(30_000).default(8000),
    readOnlyDefault: z.boolean().default(true),
  })
  .strict()
  .refine((value) => value.authType === 'none' || Boolean(value.credentialSecret?.trim()), {
    message: 'credentialSecret is required when authType is bearer or api_key_header.',
    path: ['credentialSecret'],
  });
export type McpServerConfigCreate = z.infer<typeof McpServerConfigCreateSchema>;

export const McpServerSummarySchema = z
  .object({
    serverId: z.uuid(),
    pluginId: PluginIdSchema,
    name: z.string().trim().min(1).max(80),
    endpointUrl: SafeHttpsUrlSchema,
    authType: McpAuthTypeSchema,
    hasCredential: z.boolean(),
    timeoutMs: z.number().int().min(500).max(30_000),
    status: z.enum(['connected_mock', 'connected_live']),
    discoveredTools: z.array(McpDiscoveredToolSchema).max(50),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;

export const McpServerListResponseSchema = z
  .object({
    servers: z.array(McpServerSummarySchema).max(50),
    total: z.number().int().min(0).max(50),
  })
  .strict();
export type McpServerListResponse = z.infer<typeof McpServerListResponseSchema>;

export const McpServerRegisterResponseSchema = z
  .object({
    server: McpServerSummarySchema,
    registeredPlugin: PluginManifestSchema,
  })
  .strict();
export type McpServerRegisterResponse = z.infer<typeof McpServerRegisterResponseSchema>;

export const CalendarOAuthProviderSchema = z.enum([
  'google_calendar',
  'microsoft_outlook',
  'feishu_calendar',
  'caldav_ics',
]);
export type CalendarOAuthProvider = z.infer<typeof CalendarOAuthProviderSchema>;

export const CalendarConnectionStatusSchema = z.enum([
  'active',
  'revoked',
  'sync_error',
  'reauth_required',
]);
export type CalendarConnectionStatus = z.infer<typeof CalendarConnectionStatusSchema>;

export const CalendarConnectAuthorizeRequestSchema = z
  .object({
    provider: CalendarOAuthProviderSchema,
    redirectUri: SafeHttpsUrlSchema.optional(),
    loginHint: z.string().trim().min(3).max(160).optional(),
    allowLive: z.boolean().default(false),
  })
  .strict();
export type CalendarConnectAuthorizeRequest = z.infer<typeof CalendarConnectAuthorizeRequestSchema>;

export const CalendarConnectAuthorizeResponseSchema = z
  .object({
    provider: CalendarOAuthProviderSchema,
    authorizationUrl: z.url().max(2000),
    stateToken: z.string().min(16).max(512),
    expiresAt: z.iso.datetime(),
    scopes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
    providerMode: PluginProviderModeSchema,
  })
  .strict();
export type CalendarConnectAuthorizeResponse = z.infer<
  typeof CalendarConnectAuthorizeResponseSchema
>;

export const CalendarConnectCallbackRequestSchema = z
  .object({
    provider: CalendarOAuthProviderSchema,
    code: z.string().trim().min(4).max(1024),
    stateToken: z.string().min(16).max(512),
    redirectUri: SafeHttpsUrlSchema.optional(),
    allowLive: z.boolean().default(false),
  })
  .strict();
export type CalendarConnectCallbackRequest = z.infer<typeof CalendarConnectCallbackRequestSchema>;

export const CalendarConnectionSummarySchema = z
  .object({
    id: z.uuid(),
    provider: CalendarOAuthProviderSchema,
    status: CalendarConnectionStatusSchema,
    keyVersion: z.number().int().min(1),
    syncCursor: z.string().trim().min(1).max(512).nullable(),
    lastSyncedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type CalendarConnectionSummary = z.infer<typeof CalendarConnectionSummarySchema>;

export const CalendarConnectionListResponseSchema = z
  .object({
    connections: z.array(CalendarConnectionSummarySchema).max(20),
  })
  .strict();
export type CalendarConnectionListResponse = z.infer<typeof CalendarConnectionListResponseSchema>;

export const CalendarSyncRequestSchema = z
  .object({
    provider: CalendarOAuthProviderSchema,
    windowStart: z.iso.datetime().optional(),
    windowEnd: z.iso.datetime().optional(),
    forceFullSync: z.boolean().default(false),
    allowLive: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      !value.windowStart ||
      !value.windowEnd ||
      Date.parse(value.windowEnd) > Date.parse(value.windowStart),
    {
      message: 'windowEnd must be strictly after windowStart.',
      path: ['windowEnd'],
    },
  );
export type CalendarSyncRequest = z.infer<typeof CalendarSyncRequestSchema>;

export const CalendarSyncResultSchema = z
  .object({
    provider: CalendarOAuthProviderSchema,
    status: CalendarConnectionStatusSchema,
    providerMode: PluginProviderModeSchema,
    importedBlocksCount: z.number().int().min(0),
    deletedBlocksCount: z.number().int().min(0),
    previousCursor: z.string().nullable(),
    nextCursor: z.string().nullable(),
    recoveredFromExpiredCursor: z.boolean().default(false),
    lastSyncedAt: z.iso.datetime().nullable(),
    privacyNotice: z.string().trim().min(1).max(240),
  })
  .strict();
export type CalendarSyncResult = z.infer<typeof CalendarSyncResultSchema>;

export const CalendarRevokeResponseSchema = z
  .object({
    provider: CalendarOAuthProviderSchema,
    revoked: z.literal(true),
    deletedSyncedBlocksCount: z.number().int().min(0),
  })
  .strict();
export type CalendarRevokeResponse = z.infer<typeof CalendarRevokeResponseSchema>;
