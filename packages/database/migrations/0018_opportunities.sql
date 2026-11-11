CREATE TYPE public.opportunity_stage AS ENUM (
  'undergraduate', 'master', 'phd', 'postdoc', 'any'
);
CREATE TYPE public.opportunity_status AS ENUM (
  'draft', 'open', 'paused', 'closed', 'expired'
);
CREATE TYPE public.opportunity_visibility AS ENUM (
  'organization', 'campus', 'public'
);

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL,
  description text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',
  requirements text[] NOT NULL DEFAULT '{}',
  stage public.opportunity_stage NOT NULL DEFAULT 'any',
  commitment_hours_per_week integer,
  location text,
  remote_ok boolean NOT NULL DEFAULT false,
  headcount integer NOT NULL DEFAULT 1,
  deadline timestamptz,
  status public.opportunity_status NOT NULL DEFAULT 'draft',
  visibility public.opportunity_visibility NOT NULL DEFAULT 'campus',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES public.users (id),
  contact_user_id uuid REFERENCES public.users (id),
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_opportunity_title CHECK (length(trim(title)) BETWEEN 1 AND 200),
  CONSTRAINT chk_opportunity_summary CHECK (length(trim(summary)) BETWEEN 1 AND 2000),
  CONSTRAINT chk_opportunity_description CHECK (length(trim(description)) BETWEEN 1 AND 20000),
  CONSTRAINT chk_opportunity_headcount CHECK (headcount BETWEEN 1 AND 100),
  CONSTRAINT chk_opportunity_hours CHECK (
    commitment_hours_per_week IS NULL OR (commitment_hours_per_week BETWEEN 1 AND 40)
  )
);

CREATE INDEX idx_opportunities_org_status ON public.opportunities (organization_id, status);
CREATE INDEX idx_opportunities_open_deadline ON public.opportunities (deadline)
  WHERE status = 'open';
CREATE INDEX idx_opportunities_visibility_status ON public.opportunities (visibility, status);
CREATE INDEX idx_opportunities_domains ON public.opportunities USING gin (domains);
CREATE INDEX idx_opportunities_requirements ON public.opportunities USING gin (requirements);

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY opportunities_function_all ON public.opportunities
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY opportunities_migrator_all ON public.opportunities
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
ALTER TABLE public.opportunities FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.opportunities TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE ON public.opportunities TO aven_function_owner;

-- M4-01: Organization profile update and public retrieval
CREATE OR REPLACE FUNCTION app.update_organization(
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_website_url text,
  p_logo_url text
) RETURNS TABLE (
  organization_id uuid,
  name text,
  slug text,
  description text,
  type public.organization_type,
  campus_id uuid,
  website_url text,
  logo_url text,
  verification_status public.organization_verification_status,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_trimmed_name text := trim(p_name);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF NOT app.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'not organization admin' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NOT NULL AND length(v_trimmed_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid organization name' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = '22023';
  END IF;
  IF p_website_url IS NOT NULL AND length(p_website_url) > 500 THEN
    RAISE EXCEPTION 'website url too long' USING ERRCODE = '22023';
  END IF;
  IF p_logo_url IS NOT NULL AND length(p_logo_url) > 500 THEN
    RAISE EXCEPTION 'logo url too long' USING ERRCODE = '22023';
  END IF;

  IF p_name IS NOT NULL THEN
    UPDATE public.principals
    SET display_name = v_trimmed_name,
        version = principals.version + 1,
        updated_at = now()
    WHERE id = p_organization_id;
  END IF;

  UPDATE public.organizations
  SET description = COALESCE(p_description, organizations.description),
      website_url = p_website_url,
      logo_url = p_logo_url,
      updated_at = now()
  WHERE id = p_organization_id;

  RETURN QUERY
  SELECT o.id, p.display_name, o.slug, o.description, o.type, o.campus_id,
         o.website_url, o.logo_url, o.verification_status, o.updated_at
  FROM public.organizations o
  JOIN public.principals p ON p.id = o.id
  WHERE o.id = p_organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_public_organization(p_organization_id uuid)
RETURNS TABLE (
  organization_id uuid,
  name text,
  slug text,
  description text,
  type public.organization_type,
  campus_id uuid,
  website_url text,
  logo_url text,
  verification_status public.organization_verification_status,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, p.display_name, o.slug, o.description, o.type, o.campus_id,
         o.website_url, o.logo_url, o.verification_status, o.created_at
  FROM public.organizations o
  JOIN public.principals p ON p.id = o.id
  WHERE o.id = p_organization_id
    AND p.status = 'active';
END;
$$;

-- M4-02: Opportunity lifecycle functions
CREATE OR REPLACE FUNCTION app.create_opportunity_draft(
  p_organization_id uuid,
  p_title text,
  p_summary text,
  p_description text,
  p_domains text[],
  p_requirements text[],
  p_stage public.opportunity_stage,
  p_commitment_hours_per_week integer,
  p_location text,
  p_remote_ok boolean,
  p_headcount integer,
  p_deadline timestamptz,
  p_visibility public.opportunity_visibility,
  p_contact_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_opp_id uuid;
  v_contact uuid;
  v_is_member boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF NOT (app.is_org_admin(p_organization_id) OR app.can_represent(p_organization_id)) THEN
    RAISE EXCEPTION 'not authorized to create opportunity' USING ERRCODE = '42501';
  END IF;

  v_contact := COALESCE(p_contact_user_id, v_user_id);
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = v_contact
      AND m.status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'contact user must be active organization member' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.opportunities (
    organization_id, title, summary, description,
    domains, requirements, stage, commitment_hours_per_week,
    location, remote_ok, headcount, deadline,
    status, visibility, created_by, contact_user_id
  ) VALUES (
    p_organization_id, trim(p_title), trim(p_summary), trim(p_description),
    COALESCE(p_domains, '{}'), COALESCE(p_requirements, '{}'),
    COALESCE(p_stage, 'any'), p_commitment_hours_per_week,
    p_location, COALESCE(p_remote_ok, false), COALESCE(p_headcount, 1),
    p_deadline, 'draft', COALESCE(p_visibility, 'campus'),
    v_user_id, v_contact
  ) RETURNING id INTO v_opp_id;

  RETURN v_opp_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.update_opportunity(
  p_opportunity_id uuid,
  p_expected_version integer,
  p_title text,
  p_summary text,
  p_description text,
  p_domains text[],
  p_requirements text[],
  p_stage public.opportunity_stage,
  p_commitment_hours_per_week integer,
  p_location text,
  p_remote_ok boolean,
  p_headcount integer,
  p_deadline timestamptz,
  p_visibility public.opportunity_visibility,
  p_contact_user_id uuid
) RETURNS TABLE (
  opportunity_id uuid,
  version integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_opp public.opportunities%ROWTYPE;
  v_is_member boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_opp FROM public.opportunities WHERE id = p_opportunity_id FOR UPDATE;
  IF v_opp.id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = '02000';
  END IF;

  IF NOT (app.is_org_admin(v_opp.organization_id) OR app.can_represent(v_opp.organization_id)) THEN
    RAISE EXCEPTION 'not authorized to update opportunity' USING ERRCODE = '42501';
  END IF;

  IF v_opp.status = 'closed' THEN
    RAISE EXCEPTION 'closed opportunity cannot be updated' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR v_opp.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = 'P0001';
  END IF;

  IF p_contact_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = v_opp.organization_id
        AND m.user_id = p_contact_user_id
        AND m.status = 'active'
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RAISE EXCEPTION 'contact user must be active organization member' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.opportunities
  SET title = COALESCE(trim(p_title), title),
      summary = COALESCE(trim(p_summary), summary),
      description = COALESCE(trim(p_description), description),
      domains = COALESCE(p_domains, domains),
      requirements = COALESCE(p_requirements, requirements),
      stage = COALESCE(p_stage, stage),
      commitment_hours_per_week = p_commitment_hours_per_week,
      location = p_location,
      remote_ok = COALESCE(p_remote_ok, remote_ok),
      headcount = COALESCE(p_headcount, headcount),
      deadline = p_deadline,
      visibility = COALESCE(p_visibility, visibility),
      contact_user_id = COALESCE(p_contact_user_id, contact_user_id),
      version = opportunities.version + 1,
      updated_at = now()
  WHERE id = p_opportunity_id;

  RETURN QUERY
  SELECT o.id, o.version, o.updated_at
  FROM public.opportunities o
  WHERE o.id = p_opportunity_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.publish_opportunity(
  p_opportunity_id uuid,
  p_expected_version integer
) RETURNS TABLE (
  opportunity_id uuid,
  status public.opportunity_status,
  version integer,
  published_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_opp public.opportunities%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_is_member boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_opp FROM public.opportunities WHERE id = p_opportunity_id FOR UPDATE;
  IF v_opp.id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = '02000';
  END IF;

  IF NOT (app.is_org_admin(v_opp.organization_id) OR app.can_represent(v_opp.organization_id)) THEN
    RAISE EXCEPTION 'not authorized to publish opportunity' USING ERRCODE = '42501';
  END IF;

  IF v_opp.status NOT IN ('draft', 'paused') THEN
    RAISE EXCEPTION 'opportunity cannot be published from current status' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR v_opp.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = 'P0001';
  END IF;

  IF v_opp.deadline IS NOT NULL AND v_opp.deadline <= now() THEN
    RAISE EXCEPTION 'cannot publish expired opportunity' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = v_opp.organization_id;
  IF v_opp.visibility = 'campus' AND v_org.campus_id IS NULL THEN
    RAISE EXCEPTION 'organization has no campus for campus visibility' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = v_opp.organization_id
      AND m.user_id = v_opp.contact_user_id
      AND m.status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'contact user must be active organization member' USING ERRCODE = '22023';
  END IF;

  UPDATE public.opportunities
  SET status = 'open',
      published_at = COALESCE(opportunities.published_at, now()),
      version = opportunities.version + 1,
      updated_at = now()
  WHERE id = p_opportunity_id;

  RETURN QUERY
  SELECT o.id, o.status, o.version, o.published_at
  FROM public.opportunities o
  WHERE o.id = p_opportunity_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.pause_opportunity(
  p_opportunity_id uuid,
  p_expected_version integer
) RETURNS TABLE (
  opportunity_id uuid,
  status public.opportunity_status,
  version integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_opp public.opportunities%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_opp FROM public.opportunities WHERE id = p_opportunity_id FOR UPDATE;
  IF v_opp.id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = '02000';
  END IF;

  IF NOT (app.is_org_admin(v_opp.organization_id) OR app.can_represent(v_opp.organization_id)) THEN
    RAISE EXCEPTION 'not authorized to pause opportunity' USING ERRCODE = '42501';
  END IF;

  IF v_opp.status <> 'open' THEN
    RAISE EXCEPTION 'only open opportunity can be paused' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR v_opp.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.opportunities
  SET status = 'paused',
      version = opportunities.version + 1,
      updated_at = now()
  WHERE id = p_opportunity_id;

  RETURN QUERY
  SELECT o.id, o.status, o.version, o.updated_at
  FROM public.opportunities o
  WHERE o.id = p_opportunity_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.close_opportunity(
  p_opportunity_id uuid,
  p_expected_version integer
) RETURNS TABLE (
  opportunity_id uuid,
  status public.opportunity_status,
  version integer,
  closed_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_opp public.opportunities%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_opp FROM public.opportunities WHERE id = p_opportunity_id FOR UPDATE;
  IF v_opp.id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = '02000';
  END IF;

  IF NOT (app.is_org_admin(v_opp.organization_id) OR app.can_represent(v_opp.organization_id)) THEN
    RAISE EXCEPTION 'not authorized to close opportunity' USING ERRCODE = '42501';
  END IF;

  IF v_opp.status = 'closed' THEN
    RETURN QUERY
    SELECT o.id, o.status, o.version, o.closed_at
    FROM public.opportunities o
    WHERE o.id = p_opportunity_id;
    RETURN;
  END IF;

  IF p_expected_version IS NULL OR v_opp.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.opportunities
  SET status = 'closed',
      closed_at = now(),
      version = opportunities.version + 1,
      updated_at = now()
  WHERE id = p_opportunity_id;

  RETURN QUERY
  SELECT o.id, o.status, o.version, o.closed_at
  FROM public.opportunities o
  WHERE o.id = p_opportunity_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_opportunity(p_opportunity_id uuid)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  campus_id uuid,
  title text,
  summary text,
  description text,
  domains text[],
  requirements text[],
  stage public.opportunity_stage,
  commitment_hours_per_week integer,
  location text,
  remote_ok boolean,
  headcount integer,
  deadline timestamptz,
  status public.opportunity_status,
  visibility public.opportunity_visibility,
  version integer,
  created_by uuid,
  contact_user_id uuid,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  is_member boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_org_id uuid;
  v_opp_status public.opportunity_status;
  v_opp_visibility public.opportunity_visibility;
  v_opp_deadline timestamptz;
  v_org_campus_id uuid;
  v_is_member boolean := false;
BEGIN
  SELECT o.organization_id, o.status, o.visibility, o.deadline, org.campus_id
  INTO v_org_id, v_opp_status, v_opp_visibility, v_opp_deadline, v_org_campus_id
  FROM public.opportunities o
  JOIN public.organizations org ON org.id = o.organization_id
  WHERE o.id = p_opportunity_id;

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT app.is_org_member(v_org_id) INTO v_is_member;
  END IF;

  -- Access control:
  -- If not org member:
  -- 1) Draft is strictly private
  -- 2) Organization visibility is strictly private
  -- 3) Campus visibility requires verified campus membership
  -- 4) Public visibility is accessible
  IF NOT v_is_member THEN
    IF v_opp_status = 'draft' THEN
      RETURN;
    END IF;
    IF v_opp_visibility = 'organization' THEN
      RETURN;
    END IF;
    IF v_opp_visibility = 'campus' THEN
      IF v_org_campus_id IS NULL OR NOT app.is_verified_campus_member(v_org_campus_id) THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  SELECT o.id, o.organization_id, p.display_name, org.slug, org.campus_id,
         o.title, o.summary, o.description, o.domains, o.requirements,
         o.stage, o.commitment_hours_per_week, o.location, o.remote_ok,
         o.headcount, o.deadline,
         CASE
           WHEN o.status = 'open' AND o.deadline IS NOT NULL AND o.deadline <= now() THEN 'expired'::public.opportunity_status
           ELSE o.status
         END,
         o.visibility, o.version, o.created_by, o.contact_user_id,
         o.published_at, o.closed_at, o.created_at, o.updated_at, v_is_member
  FROM public.opportunities o
  JOIN public.organizations org ON org.id = o.organization_id
  JOIN public.principals p ON p.id = org.id
  WHERE o.id = p_opportunity_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_organization_opportunities(p_organization_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  summary text,
  stage public.opportunity_stage,
  status public.opportunity_status,
  visibility public.opportunity_visibility,
  headcount integer,
  deadline timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
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
  SELECT o.id, o.title, o.summary, o.stage,
         CASE
           WHEN o.status = 'open' AND o.deadline IS NOT NULL AND o.deadline <= now() THEN 'expired'::public.opportunity_status
           ELSE o.status
         END,
         o.visibility, o.headcount, o.deadline, o.published_at, o.closed_at, o.created_at, o.updated_at
  FROM public.opportunities o
  WHERE o.organization_id = p_organization_id
  ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_public_opportunities(
  p_campus_id uuid,
  p_stage public.opportunity_stage,
  p_domain text
) RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  campus_id uuid,
  title text,
  summary text,
  domains text[],
  stage public.opportunity_stage,
  commitment_hours_per_week integer,
  location text,
  remote_ok boolean,
  headcount integer,
  deadline timestamptz,
  visibility public.opportunity_visibility,
  published_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT o.id, o.organization_id, p.display_name, org.slug, org.campus_id,
         o.title, o.summary, o.domains, o.stage, o.commitment_hours_per_week,
         o.location, o.remote_ok, o.headcount, o.deadline, o.visibility,
         o.published_at
  FROM public.opportunities o
  JOIN public.organizations org ON org.id = o.organization_id
  JOIN public.principals p ON p.id = org.id
  WHERE o.status = 'open'
    AND (o.deadline IS NULL OR o.deadline > now())
    AND (
      o.visibility = 'public'
      OR (
        o.visibility = 'campus'
        AND org.campus_id IS NOT NULL
        AND app.is_verified_campus_member(org.campus_id)
      )
    )
    AND (p_campus_id IS NULL OR org.campus_id = p_campus_id)
    AND (p_stage IS NULL OR o.stage = p_stage OR o.stage = 'any')
    AND (p_domain IS NULL OR p_domain = ANY(o.domains))
  ORDER BY o.published_at DESC NULLS LAST, o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.expire_due_opportunities()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE public.opportunities
    SET status = 'expired',
        version = version + 1,
        updated_at = now()
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline <= now()
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

-- Ownership & permission hardening
GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.update_organization(uuid, text, text, text, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_public_organization(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_opportunity_draft(uuid, text, text, text, text[], text[], public.opportunity_stage, integer, text, boolean, integer, timestamptz, public.opportunity_visibility, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.update_opportunity(uuid, integer, text, text, text, text[], text[], public.opportunity_stage, integer, text, boolean, integer, timestamptz, public.opportunity_visibility, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.publish_opportunity(uuid, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.pause_opportunity(uuid, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.close_opportunity(uuid, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_opportunity(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_organization_opportunities(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_public_opportunities(uuid, public.opportunity_stage, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.expire_due_opportunities() OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.update_organization(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_public_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_opportunity_draft(uuid, text, text, text, text[], text[], public.opportunity_stage, integer, text, boolean, integer, timestamptz, public.opportunity_visibility, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_opportunity(uuid, integer, text, text, text, text[], text[], public.opportunity_stage, integer, text, boolean, integer, timestamptz, public.opportunity_visibility, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_opportunity(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.pause_opportunity(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.close_opportunity(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_opportunity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_organization_opportunities(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_public_opportunities(uuid, public.opportunity_stage, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.expire_due_opportunities() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.update_organization(uuid, text, text, text, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_public_organization(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.create_opportunity_draft(uuid, text, text, text, text[], text[], public.opportunity_stage, integer, text, boolean, integer, timestamptz, public.opportunity_visibility, uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.update_opportunity(uuid, integer, text, text, text, text[], text[], public.opportunity_stage, integer, text, boolean, integer, timestamptz, public.opportunity_visibility, uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.publish_opportunity(uuid, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.pause_opportunity(uuid, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.close_opportunity(uuid, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_opportunity(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_organization_opportunities(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_public_opportunities(uuid, public.opportunity_stage, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.expire_due_opportunities() TO aven_app, aven_worker;
