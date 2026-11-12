import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const principalType = pgEnum('principal_type', [
  'user',
  'organization',
  'project',
  'relationship',
  'system',
]);
export const principalStatus = pgEnum('principal_status', ['active', 'suspended', 'deleted']);
export const credentialType = pgEnum('credential_type', ['password']);
export const sessionClient = pgEnum('session_client', ['web', 'mobile']);
export const campusMembershipStatus = pgEnum('campus_membership_status', [
  'pending',
  'verified',
  'rejected',
  'revoked',
]);
export const campusVerificationMethod = pgEnum('campus_verification_method', [
  'email_domain',
  'manual',
  'student_id',
]);
export const organizationType = pgEnum('organization_type', [
  'lab',
  'research_group',
  'club',
  'department',
  'company',
  'other',
]);
export const organizationVerificationStatus = pgEnum('organization_verification_status', [
  'unverified',
  'pending',
  'verified',
  'rejected',
]);
export const organizationRole = pgEnum('organization_role', ['owner', 'admin', 'member']);
export const organizationMembershipStatus = pgEnum('organization_membership_status', [
  'invited',
  'active',
  'removed',
  'left',
]);
export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: principalType('type').notNull(),
    displayName: text('display_name').notNull(),
    status: principalStatus('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check('chk_principals_display_name', sql`length(trim(${table.displayName})) between 1 and 120`),
    index('idx_principals_type_status').on(table.type, table.status),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => principals.id, { onDelete: 'cascade' }),
    avatarUrl: text('avatar_url'),
    locale: text('locale').notNull().default('zh-CN'),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('idx_users_last_seen').on(table.lastSeenAt)],
);

export const userPrivate = pgTable(
  'user_private',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    emailNormalized: text('email_normalized').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phone: text('phone'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_user_private_email').on(table.emailNormalized),
    index('idx_user_private_unverified')
      .on(table.emailVerifiedAt)
      .where(sql`${table.emailVerifiedAt} is null`),
    check(
      'chk_user_private_email_normalized',
      sql`${table.emailNormalized} = lower(trim(${table.emailNormalized})) and length(${table.emailNormalized}) between 3 and 320`,
    ),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: credentialType('type').notNull().default('password'),
    passwordHash: text('password_hash').notNull(),
    passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true }).notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('uq_credentials_user_type').on(table.userId, table.type)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfTokenHash: text('csrf_token_hash'),
    client: sessionClient('client').notNull(),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    uniqueIndex('uq_sessions_token_hash').on(table.tokenHash),
    index('idx_sessions_user_active')
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_email_verification_tokens_hash').on(table.tokenHash),
    index('idx_email_verification_tokens_user_expiry').on(table.userId, table.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_password_reset_tokens_hash').on(table.tokenHash),
    index('idx_password_reset_tokens_user_expiry').on(table.userId, table.expiresAt),
  ],
);

export const campuses = pgTable(
  'campuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    city: text('city'),
    country: text('country').notNull().default('CN'),
    emailDomains: text('email_domains').array(),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (table) => [uniqueIndex('uq_campuses_slug').on(table.slug)],
);

export const campusMemberships = pgTable(
  'campus_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: campusMembershipStatus('status').notNull().default('pending'),
    verificationMethod: campusVerificationMethod('verification_method'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id),
    evidenceRef: text('evidence_ref'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_campus_memberships_campus_user').on(table.campusId, table.userId),
    check(
      'chk_campus_membership_verified',
      sql`${table.status} <> 'verified' or ${table.verifiedAt} is not null`,
    ),
  ],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => principals.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    description: text('description'),
    type: organizationType('type').notNull(),
    campusId: uuid('campus_id').references(() => campuses.id),
    websiteUrl: text('website_url'),
    logoUrl: text('logo_url'),
    verificationStatus: organizationVerificationStatus('verification_status')
      .notNull()
      .default('unverified'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_organizations_slug').on(table.slug),
    index('idx_organizations_campus_type').on(table.campusId, table.type),
    index('idx_organizations_verification').on(table.verificationStatus),
  ],
);

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: organizationRole('role').notNull().default('member'),
    status: organizationMembershipStatus('status').notNull().default('invited'),
    canRepresent: boolean('can_represent').notNull().default(false),
    invitedBy: uuid('invited_by').references(() => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_org_memberships_org_user').on(table.organizationId, table.userId),
    uniqueIndex('uq_org_memberships_one_owner')
      .on(table.organizationId)
      .where(sql`${table.role} = 'owner' and ${table.status} = 'active'`),
    index('idx_org_memberships_user_status').on(table.userId, table.status),
    index('idx_org_memberships_org_role').on(table.organizationId, table.role),
  ],
);

export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    emailNormalized: text('email_normalized').notNull(),
    role: organizationRole('role').notNull().default('member'),
    tokenHash: text('token_hash').notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_org_invitations_token_hash').on(table.tokenHash),
    check('chk_org_invitation_role', sql`${table.role} <> 'owner'`),
    index('idx_org_invitations_org_status').on(table.organizationId, table.status),
    uniqueIndex('uq_org_invitations_pending_email')
      .on(table.organizationId, table.emailNormalized)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const platformRoleAssignments = pgTable(
  'platform_role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    check('chk_platform_role_assignments_role', sql`${table.role} = 'platform_admin'`),
    check('chk_platform_role_assignments_status', sql`${table.status} in ('active', 'revoked')`),
    uniqueIndex('uq_platform_role_assignments_active')
      .on(table.userId, table.role)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const opportunityStage = pgEnum('opportunity_stage', [
  'undergraduate',
  'master',
  'phd',
  'postdoc',
  'any',
]);

export const opportunityStatus = pgEnum('opportunity_status', [
  'draft',
  'open',
  'paused',
  'closed',
  'expired',
]);

export const opportunityVisibility = pgEnum('opportunity_visibility', [
  'organization',
  'campus',
  'public',
]);

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    description: text('description').notNull(),
    domains: text('domains')
      .array()
      .notNull()
      .default(sql`'{}'`),
    requirements: text('requirements')
      .array()
      .notNull()
      .default(sql`'{}'`),
    stage: opportunityStage('stage').notNull().default('any'),
    commitmentHoursPerWeek: integer('commitment_hours_per_week'),
    location: text('location'),
    remoteOk: boolean('remote_ok').notNull().default(false),
    headcount: integer('headcount').notNull().default(1),
    deadline: timestamp('deadline', { withTimezone: true }),
    status: opportunityStatus('status').notNull().default('draft'),
    visibility: opportunityVisibility('visibility').notNull().default('campus'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    contactUserId: uuid('contact_user_id').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('chk_opportunity_title', sql`length(trim(${table.title})) between 1 and 200`),
    check('chk_opportunity_summary', sql`length(trim(${table.summary})) between 1 and 2000`),
    check(
      'chk_opportunity_description',
      sql`length(trim(${table.description})) between 1 and 20000`,
    ),
    check('chk_opportunity_headcount', sql`${table.headcount} between 1 and 100`),
    check(
      'chk_opportunity_hours',
      sql`${table.commitmentHoursPerWeek} is null or (${table.commitmentHoursPerWeek} between 1 and 40)`,
    ),
    index('idx_opportunities_org_status').on(table.organizationId, table.status),
    index('idx_opportunities_open_deadline')
      .on(table.deadline)
      .where(sql`${table.status} = 'open'`),
    index('idx_opportunities_visibility_status').on(table.visibility, table.status),
  ],
);

// M5: Intents, Matching, Referrals, Consents, and Relationships

export const intentStatus = pgEnum('intent_status', ['draft', 'active', 'paused', 'closed']);
export const candidateStatus = pgEnum('candidate_status', ['active', 'stale', 'dismissed']);

export const intents = pgTable(
  'intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerPrincipalId: uuid('owner_principal_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    domains: text('domains')
      .array()
      .notNull()
      .default(sql`'{}'`),
    desiredStages: opportunityStage('desired_stages')
      .array()
      .notNull()
      .default(sql`'{}'`),
    locationPreference: text('location_preference'),
    remoteOk: boolean('remote_ok').notNull().default(false),
    commitmentHoursPerWeek: integer('commitment_hours_per_week'),
    deadline: timestamp('deadline', { withTimezone: true }),
    status: intentStatus('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check('chk_intent_title', sql`length(trim(${table.title})) between 1 and 160`),
    check('chk_intent_description', sql`length(trim(${table.description})) between 1 and 10000`),
    check(
      'chk_intent_hours',
      sql`${table.commitmentHoursPerWeek} is null or (${table.commitmentHoursPerWeek} between 1 and 40)`,
    ),
    index('idx_intents_owner_status').on(table.ownerPrincipalId, table.status),
    index('idx_intents_status_deadline')
      .on(table.deadline)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const matchCandidates = pgTable(
  'match_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    algorithmVersion: text('algorithm_version').notNull(),
    score: numeric('score', { precision: 5, scale: 4 }),
    featureScores: jsonb('feature_scores').notNull().default('{}'),
    reasons: jsonb('reasons').notNull().default('[]'),
    evidence: jsonb('evidence').notNull().default('[]'),
    status: candidateStatus('status').notNull().default('active'),
    sourceManifestHash: text('source_manifest_hash').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index('idx_match_candidates_intent_status').on(table.intentId, table.status),
    index('idx_match_candidates_opportunity_status').on(table.opportunityId, table.status),
  ],
);

export const consentPurpose = pgEnum('consent_purpose', [
  'referral',
  'relationship_context',
  'event_coordination',
  'connection_invitation',
]);
export const consentStatus = pgEnum('consent_status', ['active', 'revoked', 'expired']);
export const consentItemStatus = pgEnum('consent_item_status', [
  'active',
  'stale',
  'revoked',
  'expired',
]);
export const consentEventType = pgEnum('consent_event_type', [
  'granted',
  'revoked',
  'expired',
  'stale_marked',
  'purged',
]);
export const referralStatus = pgEnum('referral_status', [
  'sent',
  'info_requested',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
]);
export const referralSide = pgEnum('referral_side', ['applicant', 'organization']);
export const referralDecisionType = pgEnum('referral_decision_type', [
  'accepted',
  'declined',
  'info_requested',
  'withdrawn',
  'expired',
  'pending',
]);

export const consentPreviews = pgTable('consent_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  recipientPrincipalId: uuid('recipient_principal_id')
    .notNull()
    .references(() => principals.id),
  intentId: uuid('intent_id').references(() => intents.id, { onDelete: 'set null' }),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => opportunities.id, { onDelete: 'cascade' }),
  existingReferralId: uuid('existing_referral_id'),
  payloadHash: text('payload_hash').notNull(),
  sourceManifest: jsonb('source_manifest').notNull().default('{}'),
  purposeScopes: jsonb('purpose_scopes').notNull().default('{}'),
  previewData: jsonb('preview_data').notNull().default('{}'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  resultReferralId: uuid('result_referral_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const referrals = pgTable(
  'referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantUserId: uuid('applicant_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'restrict' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    candidateId: uuid('candidate_id').references(() => matchCandidates.id, {
      onDelete: 'set null',
    }),
    supersedesReferralId: uuid('supersedes_referral_id'),
    status: referralStatus('status').notNull().default('sent'),
    contentVersion: integer('content_version').notNull().default(1),
    version: integer('version').notNull().default(1),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('idx_referrals_org_status').on(table.organizationId, table.status),
    index('idx_referrals_applicant_status').on(table.applicantUserId, table.status),
  ],
);

export const referralDecisions = pgTable('referral_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  referralId: uuid('referral_id')
    .notNull()
    .references(() => referrals.id, { onDelete: 'cascade' }),
  side: referralSide('side').notNull(),
  deciderPrincipalId: uuid('decider_principal_id')
    .notNull()
    .references(() => principals.id),
  actedByUserId: uuid('acted_by_user_id')
    .notNull()
    .references(() => users.id),
  referralContentVersion: integer('referral_content_version').notNull().default(1),
  decision: referralDecisionType('decision').notNull().default('pending'),
  reason: text('reason'),
  version: integer('version').notNull().default(1),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  ...timestamps,
});

export const referralSupplements = pgTable(
  'referral_supplements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referralId: uuid('referral_id')
      .notNull()
      .references(() => referrals.id, { onDelete: 'cascade' }),
    supplementVersion: integer('supplement_version').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_referral_supplement_ver').on(table.referralId, table.supplementVersion),
    index('idx_referral_supplements_ref').on(table.referralId, table.supplementVersion),
  ],
);

export const consentGrants = pgTable('consent_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  grantorPrincipalId: uuid('grantor_principal_id')
    .notNull()
    .references(() => principals.id),
  granteePrincipalId: uuid('grantee_principal_id')
    .notNull()
    .references(() => principals.id),
  referralId: uuid('referral_id').references(() => referrals.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id'),
  connectionInvitationId: uuid('connection_invitation_id'),
  purpose: consentPurpose('purpose').notNull(),
  status: consentStatus('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull().default(1),
  supersedesGrantId: uuid('supersedes_grant_id'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => principals.id),
  revokeReason: text('revoke_reason'),
  ...timestamps,
});

export const consentGrantItems = pgTable('consent_grant_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  grantId: uuid('grant_id')
    .notNull()
    .references(() => consentGrants.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  sourceVersion: integer('source_version').notNull().default(1),
  policyVersion: integer('policy_version').notNull().default(1),
  fieldKey: text('field_key').notNull(),
  valueSnapshot: jsonb('value_snapshot').notNull(),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  sensitivity: text('sensitivity').notNull().default('normal'),
  status: consentItemStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const consentEvents = pgTable('consent_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  grantId: uuid('grant_id')
    .notNull()
    .references(() => consentGrants.id, { onDelete: 'cascade' }),
  eventType: consentEventType('event_type').notNull(),
  actorPrincipalId: uuid('actor_principal_id').references(() => principals.id),
  metadata: jsonb('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const relationshipStatus = pgEnum('relationship_status', ['active', 'closed']);
export const relationshipMemberRole = pgEnum('relationship_member_role', [
  'applicant',
  'organization_lead',
  'member',
]);
export const sharedContextStatus = pgEnum('shared_context_status', [
  'active',
  'revoked',
  'expired',
  'stale',
]);

export const relationships = pgTable('relationships', {
  id: uuid('id').primaryKey().defaultRandom(),
  referralId: uuid('referral_id')
    .notNull()
    .references(() => referrals.id),
  applicantUserId: uuid('applicant_user_id')
    .notNull()
    .references(() => users.id),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => opportunities.id),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  status: relationshipStatus('status').notNull().default('active'),
  establishedAt: timestamp('established_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: uuid('closed_by').references(() => principals.id),
  version: integer('version').notNull().default(1),
  ...timestamps,
});

export const relationshipMembers = pgTable('relationship_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  relationshipId: uuid('relationship_id')
    .notNull()
    .references(() => relationships.id, { onDelete: 'cascade' }),
  principalId: uuid('principal_id')
    .notNull()
    .references(() => principals.id),
  role: relationshipMemberRole('role').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
});

export const sharedContextItems = pgTable('shared_context_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  relationshipId: uuid('relationship_id')
    .notNull()
    .references(() => relationships.id, { onDelete: 'cascade' }),
  consentGrantId: uuid('consent_grant_id')
    .notNull()
    .references(() => consentGrants.id, { onDelete: 'cascade' }),
  consentGrantItemId: uuid('consent_grant_item_id').notNull(),
  status: sharedContextStatus('status').notNull().default('active'),
  ...timestamps,
});

// M6: Calendar, Availability, Events, and Coordination
export const availabilityStatus = pgEnum('availability_status', ['busy', 'tentative', 'free']);
export const eventStatus = pgEnum('event_status', [
  'draft',
  'proposed',
  'pending_confirmation',
  'confirmed',
  'cancelled',
  'ended',
]);
export const eventProposalStatus = pgEnum('event_proposal_status', [
  'proposed',
  'accepted',
  'superseded',
  'rejected',
]);
export const eventParticipantResponse = pgEnum('event_participant_response', [
  'pending',
  'accepted',
  'declined',
  'tentative',
]);

export const calendarConnections = pgTable('calendar_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  principalId: uuid('principal_id')
    .notNull()
    .references(() => principals.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  credentialsCiphertext: text('credentials_ciphertext').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  syncCursor: text('sync_cursor'),
  status: text('status').notNull().default('active'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  ...timestamps,
});

export const availabilityBlocks = pgTable('availability_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  principalId: uuid('principal_id')
    .notNull()
    .references(() => principals.id, { onDelete: 'cascade' }),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  status: availabilityStatus('status').notNull().default('busy'),
  source: text('source').notNull().default('manual'),
  version: integer('version').notNull().default(1),
  ...timestamps,
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizerPrincipalId: uuid('organizer_principal_id')
    .notNull()
    .references(() => principals.id),
  relationshipId: uuid('relationship_id').references(() => relationships.id, {
    onDelete: 'set null',
  }),
  organizationId: uuid('organization_id').references(() => principals.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  location: text('location'),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  status: eventStatus('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  ...timestamps,
});

export const eventProposals = pgTable('event_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  status: eventProposalStatus('status').notNull().default('proposed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const eventParticipants = pgTable('event_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  principalId: uuid('principal_id')
    .notNull()
    .references(() => principals.id),
  role: text('role').notNull().default('attendee'),
  response: eventParticipantResponse('response').notNull().default('pending'),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  ...timestamps,
});

export const userAiProviders = pgTable(
  'user_ai_providers',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    baseUrl: text('base_url').notNull(),
    model: text('model').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('user_ai_provider_base_url_length', sql`length(${table.baseUrl}) between 1 and 2048`),
    check('user_ai_provider_model_length', sql`length(trim(${table.model})) between 1 and 120`),
    check(
      'user_ai_provider_encrypted_key_length',
      sql`length(${table.encryptedKey}) between 1 and 4096`,
    ),
    check('user_ai_provider_version_positive', sql`${table.version} > 0`),
  ],
);

// Personal connections (ADR-011). Deferred binding constraints live in SQL migrations.
export const connectionPreviews = pgTable('connection_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => users.id),
  recipientUserId: uuid('recipient_user_id')
    .notNull()
    .references(() => users.id),
  memoryItemIds: uuid('memory_item_ids').array().notNull(),
  manifest: jsonb('manifest').notNull(),
  grantExpiresAt: timestamp('grant_expires_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  resultInvitationId: uuid('result_invitation_id'),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const connectionInvitations = pgTable(
  'connection_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => users.id),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id),
    previewId: uuid('preview_id')
      .notNull()
      .unique()
      .references(() => connectionPreviews.id),
    idempotencyKey: uuid('idempotency_key').notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .unique()
      .references(() => consentGrants.id),
    status: text('status').notNull().default('pending'),
    version: integer('version').notNull().default(1),
    senderConfirmedAt: timestamp('sender_confirmed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    recipientDecidedAt: timestamp('recipient_decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_connection_sender_key').on(t.senderUserId, t.idempotencyKey),
    uniqueIndex('uq_connection_invitation_pair')
      .on(
        sql`least(${t.senderUserId},${t.recipientUserId})`,
        sql`greatest(${t.senderUserId},${t.recipientUserId})`,
      )
      .where(sql`${t.status} in ('pending','accepted')`),
  ],
);
export const peerConnections = pgTable(
  'peer_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userLow: uuid('user_low')
      .notNull()
      .references(() => users.id),
    userHigh: uuid('user_high')
      .notNull()
      .references(() => users.id),
    invitationId: uuid('invitation_id')
      .notNull()
      .unique()
      .references(() => connectionInvitations.id),
    establishedAt: timestamp('established_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_peer_connection_pair').on(t.userLow, t.userHigh),
    check('chk_peer_connection_pair', sql`${t.userLow}<${t.userHigh}`),
  ],
);
export const connectionEvents = pgTable('connection_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  invitationId: uuid('invitation_id')
    .notNull()
    .references(() => connectionInvitations.id),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => users.id),
  eventType: text('event_type').notNull(),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// M6-06A: metadata-only in-app notifications (personal connections + event coordination); policies/functions live in SQL.
export const eventCoordinationEvents = pgTable('event_coordination_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => users.id),
  eventType: text('event_type').notNull(),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  connectionInvitations: boolean('connection_invitations').notNull().default(true),
  connectionUpdates: boolean('connection_updates').notNull().default(true),
  eventInvitations: boolean('event_invitations').notNull().default(true),
  eventUpdates: boolean('event_updates').notNull().default(true),
  version: integer('version').notNull().default(1),
});
export const notificationDeliveries = pgTable('notification_deliveries', {
  eventId: uuid('event_id').primaryKey(),
  coordinationEventId: uuid('coordination_event_id').references(() => eventCoordinationEvents.id),
  recipientUserId: uuid('recipient_user_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  generation: integer('generation').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  lastErrorCode: text('last_error_code'),
  lastQueuedAt: timestamp('last_queued_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .unique()
    .references(() => notificationDeliveries.eventId),
  recipientUserId: uuid('recipient_user_id')
    .notNull()
    .references(() => users.id),
  invitationId: uuid('invitation_id').references(() => connectionInvitations.id),
  coordinationEventId: uuid('coordination_event_id').references(() => events.id, {
    onDelete: 'cascade',
  }),
  kind: text('kind').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const notificationDeliveryEvents = pgTable('notification_delivery_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => notificationDeliveries.eventId),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  eventType: text('event_type').notNull(),
  generation: integer('generation').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const peerMessages = pgTable(
  'peer_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => peerConnections.id, { onDelete: 'cascade' }),
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    clientMessageId: uuid('client_message_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedBySender: boolean('deleted_by_sender').notNull().default(false),
    deletedByRecipient: boolean('deleted_by_recipient').notNull().default(false),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_peer_messages_client_id').on(t.connectionId, t.clientMessageId),
    index('idx_peer_messages_pagination').on(t.connectionId, t.createdAt, t.id),
    index('idx_peer_messages_sender').on(t.senderUserId),
  ],
);

export const blockLists = pgTable(
  'block_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedUserId: uuid('blocked_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_block_lists_owner_blocked').on(t.ownerUserId, t.blockedUserId),
    index('idx_block_lists_owner').on(t.ownerUserId),
    index('idx_block_lists_blocked').on(t.blockedUserId),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    details: text('details'),
    status: text('status').notNull().default('open'),
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_reports_reporter').on(t.reporterUserId),
    index('idx_reports_status_created').on(t.status, t.createdAt),
  ],
);
