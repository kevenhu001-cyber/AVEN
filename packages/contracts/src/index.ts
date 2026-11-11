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
