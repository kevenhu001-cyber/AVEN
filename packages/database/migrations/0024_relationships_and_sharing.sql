-- Migration: 0024_relationships_and_sharing.sql
-- M5-05, M5-06, M5-07: Relationship Space, Shared Context, and Revocation Propagation

CREATE TYPE public.relationship_status AS ENUM (
  'active', 'closed'
);

CREATE TYPE public.relationship_member_role AS ENUM (
  'applicant', 'organization_lead', 'member'
);

CREATE TYPE public.shared_context_status AS ENUM (
  'active', 'revoked', 'expired', 'stale'
);

-- Relationships Table
CREATE TABLE public.relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL UNIQUE,
  applicant_user_id uuid NOT NULL REFERENCES public.users (id),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities (id),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  status public.relationship_status NOT NULL DEFAULT 'active',
  established_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid REFERENCES public.principals (id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_relationships_applicant_opp UNIQUE (applicant_user_id, opportunity_id),
  CONSTRAINT fk_relationships_referral_compound FOREIGN KEY (referral_id, applicant_user_id, opportunity_id)
    REFERENCES public.referrals (id, applicant_user_id, opportunity_id) ON DELETE RESTRICT
);

CREATE INDEX idx_relationships_org_status ON public.relationships (organization_id, status);
CREATE INDEX idx_relationships_applicant_status ON public.relationships (applicant_user_id, status);

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY relationships_function_all ON public.relationships
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY relationships_migrator_all ON public.relationships
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY relationships_member_select ON public.relationships
  FOR SELECT TO aven_app
  USING (
    applicant_user_id = app.current_user_id()
    OR organization_id = app.current_principal_id()
    OR app.is_org_member(organization_id)
  );
ALTER TABLE public.relationships FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.relationships TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationships TO aven_function_owner;

-- Relationship Members
CREATE TABLE public.relationship_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES public.relationships (id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES public.principals (id),
  role public.relationship_member_role NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT uq_relationship_members UNIQUE (relationship_id, principal_id)
);

CREATE INDEX idx_relationship_members_principal ON public.relationship_members (principal_id);

ALTER TABLE public.relationship_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY relationship_members_function_all ON public.relationship_members
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY relationship_members_migrator_all ON public.relationship_members
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY relationship_members_participant_select ON public.relationship_members
  FOR SELECT TO aven_app
  USING (
    principal_id = app.current_principal_id()
    OR relationship_id IN (
      SELECT id FROM public.relationships
      WHERE applicant_user_id = app.current_user_id()
         OR organization_id = app.current_principal_id()
         OR app.is_org_member(organization_id)
    )
  );
ALTER TABLE public.relationship_members FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.relationship_members TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_members TO aven_function_owner;

-- Shared Context Items
CREATE TABLE public.shared_context_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES public.relationships (id) ON DELETE CASCADE,
  consent_grant_id uuid NOT NULL REFERENCES public.consent_grants (id) ON DELETE CASCADE,
  consent_grant_item_id uuid NOT NULL,
  status public.shared_context_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shared_context_items UNIQUE (relationship_id, consent_grant_item_id),
  CONSTRAINT fk_shared_context_grant_item FOREIGN KEY (consent_grant_id, consent_grant_item_id)
    REFERENCES public.consent_grant_items (grant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_shared_context_relationship_status ON public.shared_context_items (relationship_id, status);

ALTER TABLE public.shared_context_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY shared_context_items_function_all ON public.shared_context_items
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY shared_context_items_migrator_all ON public.shared_context_items
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
ALTER TABLE public.shared_context_items FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.shared_context_items TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_context_items TO aven_function_owner;

-- Stored Functions for Relationships and Context Sharing

CREATE OR REPLACE FUNCTION app.establish_relationship(
  p_referral_id uuid
) RETURNS TABLE (
  relationship_id uuid,
  referral_id uuid,
  applicant_user_id uuid,
  opportunity_id uuid,
  organization_id uuid,
  status public.relationship_status,
  established_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_ref public.referrals;
  v_opp public.opportunities;
  v_existing_rel public.relationships;
  v_rel_id uuid;
  v_now timestamptz := clock_timestamp();
  v_rel_grant public.consent_grants;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_ref
  FROM public.referrals
  WHERE referrals.id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'P0002';
  END IF;

  -- Only applicant or organization admin can trigger establishment
  IF v_ref.applicant_user_id <> v_user_id AND NOT app.is_org_admin(v_ref.organization_id) THEN
    RAISE EXCEPTION 'not authorized to establish relationship' USING ERRCODE = '42501';
  END IF;

  IF v_ref.status <> 'accepted' THEN
    RAISE EXCEPTION 'referral must be accepted before establishing relationship' USING ERRCODE = '22023';
  END IF;

  -- Check if relationship already exists (Idempotent)
  SELECT * INTO v_existing_rel
  FROM public.relationships
  WHERE relationships.referral_id = p_referral_id;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      v_existing_rel.id,
      v_existing_rel.referral_id,
      v_existing_rel.applicant_user_id,
      v_existing_rel.opportunity_id,
      v_existing_rel.organization_id,
      v_existing_rel.status,
      v_existing_rel.established_at;
    RETURN;
  END IF;

  -- Verify opportunity
  SELECT * INTO v_opp
  FROM public.opportunities
  WHERE opportunities.id = v_ref.opportunity_id;

  -- Insert relationship
  INSERT INTO public.relationships (
    referral_id,
    applicant_user_id,
    opportunity_id,
    organization_id,
    status,
    established_at
  ) VALUES (
    v_ref.id,
    v_ref.applicant_user_id,
    v_ref.opportunity_id,
    v_ref.organization_id,
    'active',
    v_now
  )
  RETURNING relationships.id INTO v_rel_id;

  -- Add members: Applicant
  INSERT INTO public.relationship_members (
    relationship_id,
    principal_id,
    role,
    joined_at
  ) VALUES (
    v_rel_id,
    v_ref.applicant_user_id,
    'applicant',
    v_now
  );

  -- Add members: Organization Lead (contact user or opportunity creator)
  INSERT INTO public.relationship_members (
    relationship_id,
    principal_id,
    role,
    joined_at
  ) VALUES (
    v_rel_id,
    coalesce(v_opp.contact_user_id, v_opp.created_by),
    'organization_lead',
    v_now
  )
  ON CONFLICT (relationship_id, principal_id) DO NOTHING;

  -- Add members: Organization principal itself
  INSERT INTO public.relationship_members (
    relationship_id,
    principal_id,
    role,
    joined_at
  ) VALUES (
    v_rel_id,
    v_ref.organization_id,
    'member',
    v_now
  )
  ON CONFLICT (relationship_id, principal_id) DO NOTHING;

  -- Link approved relationship_context consent grant items into shared_context_items
  SELECT * INTO v_rel_grant
  FROM public.consent_grants
  WHERE referral_id = v_ref.id
    AND purpose = 'relationship_context'
    AND status = 'active'
    AND expires_at > v_now;

  IF FOUND THEN
    FOR v_item IN
      SELECT id, grant_id
      FROM public.consent_grant_items
      WHERE grant_id = v_rel_grant.id
        AND status = 'active'
    LOOP
      INSERT INTO public.shared_context_items (
        relationship_id,
        consent_grant_id,
        consent_grant_item_id,
        status
      ) VALUES (
        v_rel_id,
        v_item.grant_id,
        v_item.id,
        'active'
      )
      ON CONFLICT (relationship_id, consent_grant_item_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.referral_id,
    r.applicant_user_id,
    r.opportunity_id,
    r.organization_id,
    r.status,
    r.established_at
  FROM public.relationships r
  WHERE r.id = v_rel_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_relationship(
  p_relationship_id uuid
) RETURNS TABLE (
  id uuid,
  referral_id uuid,
  applicant_user_id uuid,
  applicant_name text,
  opportunity_id uuid,
  opportunity_title text,
  organization_id uuid,
  organization_name text,
  status public.relationship_status,
  established_at timestamptz,
  closed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_rel public.relationships;
  v_is_member boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_rel
  FROM public.relationships
  WHERE relationships.id = p_relationship_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship not found' USING ERRCODE = 'P0002';
  END IF;

  v_is_member := (v_rel.applicant_user_id = v_user_id) OR app.is_org_member(v_rel.organization_id);

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'access denied to relationship' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.referral_id,
    r.applicant_user_id,
    u_p.display_name AS applicant_name,
    r.opportunity_id,
    o.title AS opportunity_title,
    r.organization_id,
    org_p.display_name AS organization_name,
    r.status,
    r.established_at,
    r.closed_at
  FROM public.relationships r
  JOIN public.principals u_p ON u_p.id = r.applicant_user_id
  JOIN public.opportunities o ON o.id = r.opportunity_id
  JOIN public.principals org_p ON org_p.id = r.organization_id
  WHERE r.id = p_relationship_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_my_relationships()
RETURNS TABLE (
  id uuid,
  opportunity_id uuid,
  opportunity_title text,
  organization_id uuid,
  organization_name text,
  status public.relationship_status,
  established_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.opportunity_id,
    o.title AS opportunity_title,
    r.organization_id,
    p.display_name AS organization_name,
    r.status,
    r.established_at
  FROM public.relationships r
  JOIN public.opportunities o ON o.id = r.opportunity_id
  JOIN public.principals p ON p.id = r.organization_id
  WHERE r.applicant_user_id = v_user_id
  ORDER BY r.established_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_organization_relationships(
  p_organization_id uuid
) RETURNS TABLE (
  id uuid,
  applicant_user_id uuid,
  applicant_name text,
  opportunity_id uuid,
  opportunity_title text,
  status public.relationship_status,
  established_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF NOT app.is_org_member(p_organization_id) THEN
    RAISE EXCEPTION 'not organization member' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.applicant_user_id,
    p.display_name AS applicant_name,
    r.opportunity_id,
    o.title AS opportunity_title,
    r.status,
    r.established_at
  FROM public.relationships r
  JOIN public.principals p ON p.id = r.applicant_user_id
  JOIN public.opportunities o ON o.id = r.opportunity_id
  WHERE r.organization_id = p_organization_id
  ORDER BY r.established_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.close_relationship(
  p_relationship_id uuid,
  p_reason text DEFAULT 'Closed by participant'
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_rel public.relationships;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_rel
  FROM public.relationships
  WHERE relationships.id = p_relationship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_rel.applicant_user_id <> v_user_id AND NOT app.is_org_admin(v_rel.organization_id) THEN
    RAISE EXCEPTION 'not authorized to close relationship' USING ERRCODE = '42501';
  END IF;

  UPDATE public.relationships
  SET
    status = 'closed',
    closed_at = v_now,
    closed_by = v_user_id,
    version = version + 1,
    updated_at = v_now
  WHERE id = p_relationship_id;

  UPDATE public.shared_context_items
  SET
    status = 'revoked',
    updated_at = v_now
  WHERE relationship_id = p_relationship_id;

  RETURN true;
END;
$$;

-- M5-07: Revocation Propagation for Shared Context
-- Strictly checks consent_grants status and expiry in real-time
CREATE OR REPLACE FUNCTION app.get_relationship_shared_context(
  p_relationship_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_rel public.relationships;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_rel
  FROM public.relationships
  WHERE relationships.id = p_relationship_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_rel.applicant_user_id <> v_user_id AND NOT app.is_org_member(v_rel.organization_id) THEN
    RAISE EXCEPTION 'access denied to relationship context' USING ERRCODE = '42501';
  END IF;

  -- If relationship itself is closed, shared context is immediately inaccessible
  IF v_rel.status = 'closed' THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Select only active items whose parent consent_grant is ACTIVE and NOT EXPIRED and NOT REVOKED
  SELECT jsonb_object_agg(cgi.field_key, cgi.value_snapshot) INTO v_result
  FROM public.shared_context_items sci
  JOIN public.consent_grants cg ON cg.id = sci.consent_grant_id
  JOIN public.consent_grant_items cgi ON cgi.id = sci.consent_grant_item_id
  WHERE sci.relationship_id = p_relationship_id
    AND sci.status = 'active'
    AND cg.status = 'active'
    AND cg.expires_at > clock_timestamp()
    AND cgi.status = 'active';

  RETURN coalesce(v_result, '{}'::jsonb);
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.establish_relationship(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_relationship(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_relationships() OWNER TO aven_function_owner;
ALTER FUNCTION app.list_organization_relationships(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.close_relationship(uuid, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_relationship_shared_context(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.establish_relationship FROM public;
REVOKE ALL ON FUNCTION app.get_relationship FROM public;
REVOKE ALL ON FUNCTION app.list_my_relationships FROM public;
REVOKE ALL ON FUNCTION app.list_organization_relationships FROM public;
REVOKE ALL ON FUNCTION app.close_relationship FROM public;
REVOKE ALL ON FUNCTION app.get_relationship_shared_context FROM public;

GRANT EXECUTE ON FUNCTION app.establish_relationship TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_relationship TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_relationships TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_organization_relationships TO aven_app;
GRANT EXECUTE ON FUNCTION app.close_relationship TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_relationship_shared_context TO aven_app;
