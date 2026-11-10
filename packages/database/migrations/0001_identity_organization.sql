CREATE TYPE "public"."campus_membership_status" AS ENUM('pending', 'verified', 'rejected', 'revoked');
CREATE TYPE "public"."campus_verification_method" AS ENUM('email_domain', 'manual', 'student_id');
CREATE TYPE "public"."credential_type" AS ENUM('password');
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');
CREATE TYPE "public"."organization_membership_status" AS ENUM('invited', 'active', 'removed', 'left');
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member');
CREATE TYPE "public"."organization_type" AS ENUM('lab', 'research_group', 'club', 'department', 'company', 'other');
CREATE TYPE "public"."organization_verification_status" AS ENUM('unverified', 'pending', 'verified', 'rejected');
CREATE TYPE "public"."principal_status" AS ENUM('active', 'suspended', 'deleted');
CREATE TYPE "public"."principal_type" AS ENUM('user', 'organization', 'project', 'relationship', 'system');
CREATE TYPE "public"."session_client" AS ENUM('web', 'mobile');
CREATE TABLE "campus_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campus_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "campus_membership_status" DEFAULT 'pending' NOT NULL,
	"verification_method" "campus_verification_method",
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_campus_membership_verified" CHECK ("campus_memberships"."status" <> 'verified' or "campus_memberships"."verified_at" is not null)
);

CREATE TABLE "campuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"city" text,
	"country" text DEFAULT 'CN' NOT NULL,
	"email_domains" text[],
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "credential_type" DEFAULT 'password' NOT NULL,
	"password_hash" text NOT NULL,
	"password_updated_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"role" "organization_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_org_invitation_role" CHECK ("organization_invitations"."role" <> 'owner')
);

CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organization_role" DEFAULT 'member' NOT NULL,
	"status" "organization_membership_status" DEFAULT 'invited' NOT NULL,
	"can_represent" boolean DEFAULT false NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"type" "organization_type" NOT NULL,
	"campus_id" uuid,
	"website_url" text,
	"logo_url" text,
	"verification_status" "organization_verification_status" DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "platform_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "chk_platform_role_assignments_role" CHECK ("platform_role_assignments"."role" = 'platform_admin'),
	CONSTRAINT "chk_platform_role_assignments_status" CHECK ("platform_role_assignments"."status" in ('active', 'revoked'))
);

CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "principal_type" NOT NULL,
	"display_name" text NOT NULL,
	"status" "principal_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_principals_display_name" CHECK (length(trim("principals"."display_name")) between 1 and 120)
);

CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"client" "session_client" NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);

CREATE TABLE "user_private" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_normalized" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"avatar_url" text,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "campus_memberships" ADD CONSTRAINT "campus_memberships_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "campus_memberships" ADD CONSTRAINT "campus_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "campus_memberships" ADD CONSTRAINT "campus_memberships_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_id_principals_id_fk" FOREIGN KEY ("id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_private" ADD CONSTRAINT "user_private_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_id_principals_id_fk" FOREIGN KEY ("id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "uq_campus_memberships_campus_user" ON "campus_memberships" USING btree ("campus_id","user_id");
CREATE UNIQUE INDEX "uq_campuses_slug" ON "campuses" USING btree ("slug");
CREATE UNIQUE INDEX "uq_credentials_user_type" ON "credentials" USING btree ("user_id","type");
CREATE UNIQUE INDEX "uq_email_verification_tokens_hash" ON "email_verification_tokens" USING btree ("token_hash");
CREATE INDEX "idx_email_verification_tokens_user_expiry" ON "email_verification_tokens" USING btree ("user_id","expires_at");
CREATE UNIQUE INDEX "uq_org_invitations_token_hash" ON "organization_invitations" USING btree ("token_hash");
CREATE INDEX "idx_org_invitations_org_status" ON "organization_invitations" USING btree ("organization_id","status");
CREATE UNIQUE INDEX "uq_org_invitations_pending_email" ON "organization_invitations" USING btree ("organization_id","email_normalized") WHERE "organization_invitations"."status" = 'pending';
CREATE UNIQUE INDEX "uq_org_memberships_org_user" ON "organization_memberships" USING btree ("organization_id","user_id");
CREATE UNIQUE INDEX "uq_org_memberships_one_owner" ON "organization_memberships" USING btree ("organization_id") WHERE "organization_memberships"."role" = 'owner' and "organization_memberships"."status" = 'active';
CREATE INDEX "idx_org_memberships_user_status" ON "organization_memberships" USING btree ("user_id","status");
CREATE INDEX "idx_org_memberships_org_role" ON "organization_memberships" USING btree ("organization_id","role");
CREATE UNIQUE INDEX "uq_organizations_slug" ON "organizations" USING btree ("slug");
CREATE INDEX "idx_organizations_campus_type" ON "organizations" USING btree ("campus_id","type");
CREATE INDEX "idx_organizations_verification" ON "organizations" USING btree ("verification_status");
CREATE UNIQUE INDEX "uq_password_reset_tokens_hash" ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX "idx_password_reset_tokens_user_expiry" ON "password_reset_tokens" USING btree ("user_id","expires_at");
CREATE UNIQUE INDEX "uq_platform_role_assignments_active" ON "platform_role_assignments" USING btree ("user_id","role") WHERE "platform_role_assignments"."status" = 'active';
CREATE INDEX "idx_principals_type_status" ON "principals" USING btree ("type","status");
CREATE UNIQUE INDEX "uq_sessions_token_hash" ON "sessions" USING btree ("token_hash");
CREATE INDEX "idx_sessions_user_active" ON "sessions" USING btree ("user_id","expires_at") WHERE "sessions"."revoked_at" is null;
CREATE UNIQUE INDEX "uq_user_private_email" ON "user_private" USING btree ("email_normalized");
CREATE INDEX "idx_user_private_unverified" ON "user_private" USING btree ("email_verified_at") WHERE "user_private"."email_verified_at" is null;
CREATE INDEX "idx_users_last_seen" ON "users" USING btree ("last_seen_at");