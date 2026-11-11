import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
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
