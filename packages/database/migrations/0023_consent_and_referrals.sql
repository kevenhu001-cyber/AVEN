-- Migration: 0023_consent_and_referrals.sql
-- M5-03 & M5-04: Purpose-Bound Consent, Referrals, and Decisions

CREATE TYPE public.consent_purpose AS ENUM (
  'referral', 'relationship_context', 'event_coordination'
);

CREATE TYPE public.consent_status AS ENUM (
  'active', 'revoked', 'expired'
);

ALTER TYPE public.consent_source_type ADD VALUE IF NOT EXISTS 'memory';
ALTER TYPE public.consent_source_type ADD VALUE IF NOT EXISTS 'project';

CREATE TYPE public.consent_item_status AS ENUM (
  'active', 'stale', 'revoked', 'expired'
);

CREATE TYPE public.consent_event_type AS ENUM (
  'granted', 'revoked', 'expired', 'stale_marked', 'purged'
);

CREATE TYPE public.referral_status AS ENUM (
  'sent', 'info_requested', 'accepted', 'declined', 'withdrawn', 'expired'
);

CREATE TYPE public.referral_side AS ENUM (
  'applicant', 'organization'
);

CREATE TYPE public.referral_decision_type AS ENUM (
  'accepted', 'declined', 'info_requested', 'withdrawn', 'expired', 'pending'
);

-- Consent Previews
CREATE TABLE public.consent_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  recipient_principal_id uuid NOT NULL REFERENCES public.principals (id),
  intent_id uuid REFERENCES public.intents (id) ON DELETE SET NULL,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities (id) ON DELETE CASCADE,
  existing_referral_id uuid,
  payload_hash text NOT NULL,
  source_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  purpose_scopes jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  result_referral_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_previews_actor ON public.consent_previews (actor_user_id, expires_at);

ALTER TABLE public.consent_previews ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_previews_function_all ON public.consent_previews
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY consent_previews_migrator_all ON public.consent_previews
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
ALTER TABLE public.consent_previews FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.consent_previews TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_previews TO aven_function_owner;

-- Referrals
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  intent_id uuid NOT NULL REFERENCES public.intents (id) ON DELETE RESTRICT,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities (id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  candidate_id uuid REFERENCES public.match_candidates (id) ON DELETE SET NULL,
  supersedes_referral_id uuid REFERENCES public.referrals (id) ON DELETE SET NULL,
  status public.referral_status NOT NULL DEFAULT 'sent',
  content_version integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_referrals_applicant_opp UNIQUE (id, applicant_user_id, opportunity_id)
);

CREATE UNIQUE INDEX uq_referrals_active_pair ON public.referrals (applicant_user_id, opportunity_id)
  WHERE status IN ('sent', 'info_requested', 'accepted');
CREATE INDEX idx_referrals_org_status ON public.referrals (organization_id, status);
CREATE INDEX idx_referrals_applicant_status ON public.referrals (applicant_user_id, status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY referrals_function_all ON public.referrals
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY referrals_migrator_all ON public.referrals
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY referrals_participant_select ON public.referrals
  FOR SELECT TO aven_app
  USING (
    applicant_user_id = app.current_user_id()
    OR organization_id = app.current_principal_id()
    OR app.is_org_member(organization_id)
  );
ALTER TABLE public.referrals FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.referrals TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals TO aven_function_owner;

-- Referral Decisions
CREATE TABLE public.referral_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals (id) ON DELETE CASCADE,
  side public.referral_side NOT NULL,
  decider_principal_id uuid NOT NULL REFERENCES public.principals (id),
  acted_by_user_id uuid NOT NULL REFERENCES public.users (id),
  referral_content_version integer NOT NULL DEFAULT 1,
  decision public.referral_decision_type NOT NULL DEFAULT 'pending',
  reason text,
  version integer NOT NULL DEFAULT 1,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_referral_decisions_side UNIQUE (referral_id, side)
);

ALTER TABLE public.referral_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_decisions_function_all ON public.referral_decisions
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY referral_decisions_migrator_all ON public.referral_decisions
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY referral_decisions_participant_select ON public.referral_decisions
  FOR SELECT TO aven_app
  USING (
    referral_id IN (
      SELECT id FROM public.referrals
      WHERE applicant_user_id = app.current_user_id()
         OR organization_id = app.current_principal_id()
         OR app.is_org_member(organization_id)
    )
  );
ALTER TABLE public.referral_decisions FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.referral_decisions TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_decisions TO aven_function_owner;

-- Consent Grants
CREATE TABLE public.consent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_principal_id uuid NOT NULL REFERENCES public.principals (id),
  grantee_principal_id uuid NOT NULL REFERENCES public.principals (id),
  referral_id uuid REFERENCES public.referrals (id) ON DELETE CASCADE,
  event_id uuid,
  purpose public.consent_purpose NOT NULL,
  status public.consent_status NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  supersedes_grant_id uuid REFERENCES public.consent_grants (id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.principals (id),
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_consent_parties CHECK (grantor_principal_id <> grantee_principal_id),
  CONSTRAINT chk_consent_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_consent_revoked CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE INDEX idx_consent_grants_grantor_status ON public.consent_grants (grantor_principal_id, status);
CREATE INDEX idx_consent_grants_grantee_status ON public.consent_grants (grantee_principal_id, status);
CREATE INDEX idx_consent_grants_referral_purpose ON public.consent_grants (referral_id, purpose);

ALTER TABLE public.consent_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_grants_function_all ON public.consent_grants
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY consent_grants_migrator_all ON public.consent_grants
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY consent_grants_participant_select ON public.consent_grants
  FOR SELECT TO aven_app
  USING (
    grantor_principal_id = app.current_principal_id()
    OR grantee_principal_id = app.current_principal_id()
  );
ALTER TABLE public.consent_grants FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.consent_grants TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_grants TO aven_function_owner;

-- Consent Grant Items
CREATE TABLE public.consent_grant_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.consent_grants (id) ON DELETE CASCADE,
  source_type public.consent_source_type NOT NULL,
  source_id uuid NOT NULL,
  source_version integer NOT NULL DEFAULT 1,
  policy_version integer NOT NULL DEFAULT 1,
  field_key text NOT NULL,
  value_snapshot jsonb NOT NULL,
  purged_at timestamptz,
  sensitivity public.sensitivity NOT NULL DEFAULT 'normal',
  status public.consent_item_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_consent_grant_items_key UNIQUE (grant_id, source_type, source_id, field_key),
  CONSTRAINT uq_consent_grant_items_id_grant UNIQUE (grant_id, id)
);

ALTER TABLE public.consent_grant_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_grant_items_function_all ON public.consent_grant_items
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY consent_grant_items_migrator_all ON public.consent_grant_items
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
ALTER TABLE public.consent_grant_items FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.consent_grant_items TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_grant_items TO aven_function_owner;

-- Consent Events
CREATE TABLE public.consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.consent_grants (id) ON DELETE CASCADE,
  event_type public.consent_event_type NOT NULL,
  actor_principal_id uuid REFERENCES public.principals (id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_events_grant_created ON public.consent_events (grant_id, created_at);

ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_events_function_all ON public.consent_events
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY consent_events_migrator_all ON public.consent_events
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
ALTER TABLE public.consent_events FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.consent_events TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_events TO aven_function_owner;

-- Stored Functions for Consent & Referrals

CREATE OR REPLACE FUNCTION app.create_consent_preview(
  p_opportunity_id uuid,
  p_intent_id uuid DEFAULT NULL,
  p_purpose_scopes jsonb DEFAULT '{"referral": {"fields": ["display_name", "skills", "bio"], "expires_in_days": 14}}'::jsonb
) RETURNS TABLE (
  preview_id uuid,
  opportunity_id uuid,
  recipient_organization_id uuid,
  recipient_organization_name text,
  purpose_scopes jsonb,
  preview_data jsonb,
  expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_opp public.opportunities;
  v_org_name text;
  v_user_name text;
  v_user_email text;
  v_snapshot jsonb;
  v_preview_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '10 minutes';
  v_hash text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_opp
  FROM public.opportunities
  WHERE opportunities.id = p_opportunity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_opp.status <> 'open' THEN
    RAISE EXCEPTION 'opportunity is not open' USING ERRCODE = '22023';
  END IF;

  SELECT display_name INTO v_org_name
  FROM public.principals
  WHERE principals.id = v_opp.organization_id;

  SELECT display_name INTO v_user_name
  FROM public.principals
  WHERE principals.id = v_user_id;

  -- Build preview snapshot from confirmed user profile and memories
  v_snapshot := jsonb_build_object(
    'applicant', jsonb_build_object(
      'id', v_user_id,
      'display_name', v_user_name
    ),
    'opportunity', jsonb_build_object(
      'id', v_opp.id,
      'title', v_opp.title,
      'organization_id', v_opp.organization_id,
      'organization_name', v_org_name
    ),
    'purposes', p_purpose_scopes
  );

  v_hash := md5(v_user_id::text || ':' || v_opp.id::text || ':' || v_snapshot::text);

  INSERT INTO public.consent_previews (
    actor_user_id,
    recipient_principal_id,
    intent_id,
    opportunity_id,
    payload_hash,
    purpose_scopes,
    preview_data,
    expires_at
  ) VALUES (
    v_user_id,
    v_opp.organization_id,
    p_intent_id,
    v_opp.id,
    v_hash,
    p_purpose_scopes,
    v_snapshot,
    v_expires_at
  )
  RETURNING consent_previews.id INTO v_preview_id;

  RETURN QUERY
  SELECT
    v_preview_id,
    v_opp.id,
    v_opp.organization_id,
    v_org_name,
    p_purpose_scopes,
    v_snapshot,
    v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION app.create_referral_with_consent(
  p_preview_id uuid,
  p_candidate_id uuid DEFAULT NULL
) RETURNS TABLE (
  referral_id uuid,
  applicant_user_id uuid,
  opportunity_id uuid,
  organization_id uuid,
  status public.referral_status,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_preview public.consent_previews;
  v_opp public.opportunities;
  v_referral_id uuid;
  v_referral_expires timestamptz := clock_timestamp() + interval '14 days';
  v_grant_id uuid;
  v_rel_grant_id uuid;
  v_scope jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_preview
  FROM public.consent_previews
  WHERE consent_previews.id = p_preview_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'consent preview not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_preview.actor_user_id <> v_user_id THEN
    RAISE EXCEPTION 'not preview owner' USING ERRCODE = '42501';
  END IF;
  IF v_preview.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'consent preview already consumed' USING ERRCODE = '22023';
  END IF;
  IF v_preview.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'consent preview expired' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_opp
  FROM public.opportunities
  WHERE opportunities.id = v_preview.opportunity_id;

  IF NOT FOUND OR v_opp.status <> 'open' THEN
    RAISE EXCEPTION 'opportunity closed or unavailable' USING ERRCODE = '22023';
  END IF;

  -- Create formal Referral
  INSERT INTO public.referrals (
    applicant_user_id,
    intent_id,
    opportunity_id,
    organization_id,
    candidate_id,
    status,
    expires_at
  ) VALUES (
    v_user_id,
    coalesce(v_preview.intent_id, v_opp.id), -- Fallback intent to opp id if none provided
    v_opp.id,
    v_opp.organization_id,
    p_candidate_id,
    'sent',
    v_referral_expires
  )
  RETURNING referrals.id INTO v_referral_id;

  -- Create Decisions: Applicant side (accepted upon sending)
  INSERT INTO public.referral_decisions (
    referral_id,
    side,
    decider_principal_id,
    acted_by_user_id,
    decision,
    decided_at
  ) VALUES (
    v_referral_id,
    'applicant',
    v_user_id,
    v_user_id,
    'accepted',
    clock_timestamp()
  );

  -- Organization side (pending)
  INSERT INTO public.referral_decisions (
    referral_id,
    side,
    decider_principal_id,
    acted_by_user_id,
    decision
  ) VALUES (
    v_referral_id,
    'organization',
    v_opp.organization_id,
    v_opp.created_by,
    'pending'
  );

  -- Create Consent Grant for 'referral' purpose
  INSERT INTO public.consent_grants (
    grantor_principal_id,
    grantee_principal_id,
    referral_id,
    purpose,
    status,
    expires_at
  ) VALUES (
    v_user_id,
    v_opp.organization_id,
    v_referral_id,
    'referral',
    'active',
    v_referral_expires
  )
  RETURNING consent_grants.id INTO v_grant_id;

  -- Store item snapshots for referral purpose
  INSERT INTO public.consent_grant_items (
    grant_id,
    source_type,
    source_id,
    field_key,
    value_snapshot,
    status
  ) VALUES (
    v_grant_id,
    'profile',
    v_user_id,
    'applicant_profile',
    v_preview.preview_data->'applicant',
    'active'
  );

  -- Consent event
  INSERT INTO public.consent_events (
    grant_id,
    event_type,
    actor_principal_id,
    metadata
  ) VALUES (
    v_grant_id,
    'granted',
    v_user_id,
    jsonb_build_object('referral_id', v_referral_id)
  );

  -- If relationship_context scope is confirmed in preview, create second grant
  IF (v_preview.purpose_scopes->'relationship_context') IS NOT NULL THEN
    INSERT INTO public.consent_grants (
      grantor_principal_id,
      grantee_principal_id,
      referral_id,
      purpose,
      status,
      expires_at
    ) VALUES (
      v_user_id,
      v_opp.organization_id,
      v_referral_id,
      'relationship_context',
      'active',
      clock_timestamp() + interval '90 days'
    )
    RETURNING consent_grants.id INTO v_rel_grant_id;

    INSERT INTO public.consent_grant_items (
      grant_id,
      source_type,
      source_id,
      field_key,
      value_snapshot,
      status
    ) VALUES (
      v_rel_grant_id,
      'profile',
      v_user_id,
      'relationship_context_profile',
      v_preview.preview_data->'applicant',
      'active'
    );

    INSERT INTO public.consent_events (
      grant_id,
      event_type,
      actor_principal_id,
      metadata
    ) VALUES (
      v_rel_grant_id,
      'granted',
      v_user_id,
      jsonb_build_object('referral_id', v_referral_id, 'scope', 'relationship_context')
    );
  END IF;

  -- Mark preview consumed
  UPDATE public.consent_previews
  SET
    consumed_at = clock_timestamp(),
    result_referral_id = v_referral_id
  WHERE id = p_preview_id;

  RETURN QUERY
  SELECT
    r.id,
    r.applicant_user_id,
    r.opportunity_id,
    r.organization_id,
    r.status,
    r.expires_at,
    r.created_at
  FROM public.referrals r
  WHERE r.id = v_referral_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_referral(
  p_referral_id uuid
) RETURNS TABLE (
  id uuid,
  applicant_user_id uuid,
  applicant_name text,
  opportunity_id uuid,
  opportunity_title text,
  organization_id uuid,
  organization_name text,
  status public.referral_status,
  applicant_decision public.referral_decision_type,
  org_decision public.referral_decision_type,
  org_decision_reason text,
  content_version integer,
  version integer,
  sent_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_ref public.referrals;
  v_is_applicant boolean;
  v_is_org_rep boolean;
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

  v_is_applicant := (v_ref.applicant_user_id = v_user_id);
  v_is_org_rep := app.is_org_admin(v_ref.organization_id) OR app.is_org_member(v_ref.organization_id);

  IF NOT v_is_applicant AND NOT v_is_org_rep THEN
    RAISE EXCEPTION 'forbidden from reading referral' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.applicant_user_id,
    u_p.display_name AS applicant_name,
    r.opportunity_id,
    o.title AS opportunity_title,
    r.organization_id,
    org_p.display_name AS organization_name,
    r.status,
    d_app.decision AS applicant_decision,
    d_org.decision AS org_decision,
    d_org.reason AS org_decision_reason,
    r.content_version,
    r.version,
    r.sent_at,
    r.expires_at
  FROM public.referrals r
  JOIN public.principals u_p ON u_p.id = r.applicant_user_id
  JOIN public.opportunities o ON o.id = r.opportunity_id
  JOIN public.principals org_p ON org_p.id = r.organization_id
  LEFT JOIN public.referral_decisions d_app ON d_app.referral_id = r.id AND d_app.side = 'applicant'
  LEFT JOIN public.referral_decisions d_org ON d_org.referral_id = r.id AND d_org.side = 'organization'
  WHERE r.id = p_referral_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_my_referrals()
RETURNS TABLE (
  id uuid,
  opportunity_id uuid,
  opportunity_title text,
  organization_id uuid,
  organization_name text,
  status public.referral_status,
  sent_at timestamptz,
  expires_at timestamptz
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
    r.sent_at,
    r.expires_at
  FROM public.referrals r
  JOIN public.opportunities o ON o.id = r.opportunity_id
  JOIN public.principals p ON p.id = r.organization_id
  WHERE r.applicant_user_id = v_user_id
  ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_organization_referrals(
  p_organization_id uuid,
  p_status public.referral_status DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  applicant_user_id uuid,
  applicant_name text,
  opportunity_id uuid,
  opportunity_title text,
  status public.referral_status,
  sent_at timestamptz,
  expires_at timestamptz
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
    r.sent_at,
    r.expires_at
  FROM public.referrals r
  JOIN public.principals p ON p.id = r.applicant_user_id
  JOIN public.opportunities o ON o.id = r.opportunity_id
  WHERE r.organization_id = p_organization_id
    AND (p_status IS NULL OR r.status = p_status)
  ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_referral_shared_snapshot(
  p_referral_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_ref public.referrals;
  v_grant public.consent_grants;
  v_items jsonb;
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

  -- Security check: Actor must be applicant OR org admin/member with represent rights
  IF v_ref.applicant_user_id <> v_user_id AND NOT app.is_org_admin(v_ref.organization_id) THEN
    RAISE EXCEPTION 'access denied to referral snapshot' USING ERRCODE = '42501';
  END IF;

  -- Consent check: must have active, non-expired, non-revoked referral grant
  SELECT * INTO v_grant
  FROM public.consent_grants
  WHERE referral_id = p_referral_id
    AND purpose = 'referral';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no consent grant found' USING ERRCODE = 'P0002';
  END IF;
  IF v_grant.status = 'revoked' THEN
    RAISE EXCEPTION 'consent has been revoked' USING ERRCODE = '42501';
  END IF;
  IF v_grant.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'consent has expired' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_object_agg(field_key, value_snapshot) INTO v_items
  FROM public.consent_grant_items
  WHERE grant_id = v_grant.id
    AND status = 'active';

  RETURN coalesce(v_items, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app.decide_referral(
  p_referral_id uuid,
  p_decision public.referral_decision_type,
  p_reason text,
  p_expected_version integer
) RETURNS TABLE (
  referral_id uuid,
  new_status public.referral_status,
  version integer,
  decided_at timestamptz
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
  v_now timestamptz := clock_timestamp();
  v_grant public.consent_grants;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_ref
  FROM public.referrals
  WHERE referrals.id = p_referral_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.is_org_admin(v_ref.organization_id) THEN
    RAISE EXCEPTION 'not authorized to decide referral' USING ERRCODE = '42501';
  END IF;
  IF v_ref.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_ref.status IN ('declined', 'withdrawn', 'expired') THEN
    RAISE EXCEPTION 'referral is in terminal state' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'accepted' THEN
    -- Verify opportunity still open
    SELECT * INTO v_opp
    FROM public.opportunities
    WHERE opportunities.id = v_ref.opportunity_id;

    IF v_opp.status <> 'open' OR (v_opp.deadline IS NOT NULL AND v_opp.deadline <= v_now) THEN
      RAISE EXCEPTION 'opportunity no longer available' USING ERRCODE = '22023';
    END IF;

    -- Verify consent grant still active
    SELECT * INTO v_grant
    FROM public.consent_grants
    WHERE referral_id = v_ref.id AND purpose = 'referral';

    IF NOT FOUND OR v_grant.status <> 'active' OR v_grant.expires_at <= v_now THEN
      RAISE EXCEPTION 'consent invalid or revoked' USING ERRCODE = '42501';
    END IF;

    UPDATE public.referrals
    SET
      status = 'accepted',
      version = v_ref.version + 1,
      updated_at = v_now
    WHERE id = p_referral_id;

    UPDATE public.referral_decisions
    SET
      decision = 'accepted',
      reason = p_reason,
      acted_by_user_id = v_user_id,
      decided_at = v_now,
      version = referral_decisions.version + 1,
      updated_at = v_now
    WHERE referral_id = p_referral_id AND side = 'organization';

  ELSIF p_decision = 'declined' THEN
    UPDATE public.referrals
    SET
      status = 'declined',
      version = v_ref.version + 1,
      updated_at = v_now
    WHERE id = p_referral_id;

    UPDATE public.referral_decisions
    SET
      decision = 'declined',
      reason = p_reason,
      acted_by_user_id = v_user_id,
      decided_at = v_now,
      version = referral_decisions.version + 1,
      updated_at = v_now
    WHERE referral_id = p_referral_id AND side = 'organization';

  ELSIF p_decision = 'info_requested' THEN
    UPDATE public.referrals
    SET
      status = 'info_requested',
      version = v_ref.version + 1,
      updated_at = v_now
    WHERE id = p_referral_id;

    UPDATE public.referral_decisions
    SET
      decision = 'info_requested',
      reason = p_reason,
      acted_by_user_id = v_user_id,
      decided_at = v_now,
      version = referral_decisions.version + 1,
      updated_at = v_now
    WHERE referral_id = p_referral_id AND side = 'organization';
  ELSE
    RAISE EXCEPTION 'invalid decision' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.status,
    r.version,
    v_now
  FROM public.referrals r
  WHERE r.id = p_referral_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.withdraw_referral(
  p_referral_id uuid,
  p_reason text,
  p_expected_version integer
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_ref public.referrals;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_ref
  FROM public.referrals
  WHERE referrals.id = p_referral_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_ref.applicant_user_id <> v_user_id THEN
    RAISE EXCEPTION 'not referral applicant' USING ERRCODE = '42501';
  END IF;
  IF v_ref.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_ref.status IN ('declined', 'withdrawn', 'expired') THEN
    RAISE EXCEPTION 'referral already closed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.referrals
  SET
    status = 'withdrawn',
    version = v_ref.version + 1,
    updated_at = v_now
  WHERE id = p_referral_id;

  UPDATE public.referral_decisions
  SET
    decision = 'withdrawn',
    reason = p_reason,
    acted_by_user_id = v_user_id,
    decided_at = v_now,
    version = referral_decisions.version + 1,
    updated_at = v_now
  WHERE referral_id = p_referral_id AND side = 'applicant';

  -- Automatically revoke associated consent grants
  UPDATE public.consent_grants
  SET
    status = 'revoked',
    revoked_at = v_now,
    revoked_by = v_user_id,
    revoke_reason = 'referral withdrawn',
    version = version + 1,
    updated_at = v_now
  WHERE referral_id = p_referral_id
    AND status = 'active';

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app.revoke_consent(
  p_grant_id uuid,
  p_reason text DEFAULT 'User requested revocation'
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_grant public.consent_grants;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_grant
  FROM public.consent_grants
  WHERE consent_grants.id = p_grant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'consent grant not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_grant.grantor_principal_id <> v_user_id THEN
    RAISE EXCEPTION 'only grantor can revoke consent' USING ERRCODE = '42501';
  END IF;

  IF v_grant.status = 'revoked' THEN
    RETURN true; -- Idempotent
  END IF;

  UPDATE public.consent_grants
  SET
    status = 'revoked',
    revoked_at = v_now,
    revoked_by = v_user_id,
    revoke_reason = p_reason,
    version = version + 1,
    updated_at = v_now
  WHERE id = p_grant_id;

  UPDATE public.consent_grant_items
  SET status = 'revoked'
  WHERE grant_id = p_grant_id;

  INSERT INTO public.consent_events (
    grant_id,
    event_type,
    actor_principal_id,
    metadata
  ) VALUES (
    p_grant_id,
    'revoked',
    v_user_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN true;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.create_consent_preview(uuid, uuid, jsonb) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_referral_with_consent(uuid, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_referral(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_referrals() OWNER TO aven_function_owner;
ALTER FUNCTION app.list_organization_referrals(uuid, public.referral_status) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_referral_shared_snapshot(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.decide_referral(uuid, public.referral_decision_type, text, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.withdraw_referral(uuid, text, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.revoke_consent(uuid, text) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_consent_preview FROM public;
REVOKE ALL ON FUNCTION app.create_referral_with_consent FROM public;
REVOKE ALL ON FUNCTION app.get_referral FROM public;
REVOKE ALL ON FUNCTION app.list_my_referrals FROM public;
REVOKE ALL ON FUNCTION app.list_organization_referrals FROM public;
REVOKE ALL ON FUNCTION app.get_referral_shared_snapshot FROM public;
REVOKE ALL ON FUNCTION app.decide_referral FROM public;
REVOKE ALL ON FUNCTION app.withdraw_referral FROM public;
REVOKE ALL ON FUNCTION app.revoke_consent FROM public;

GRANT EXECUTE ON FUNCTION app.create_consent_preview TO aven_app;
GRANT EXECUTE ON FUNCTION app.create_referral_with_consent TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_referral TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_referrals TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_organization_referrals TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_referral_shared_snapshot TO aven_app;
GRANT EXECUTE ON FUNCTION app.decide_referral TO aven_app;
GRANT EXECUTE ON FUNCTION app.withdraw_referral TO aven_app;
GRANT EXECUTE ON FUNCTION app.revoke_consent TO aven_app;
