-- Migration: 0022_intents_and_matching.sql
-- M5-01: Personal Intents and Explainable Matching Candidates

CREATE TYPE public.intent_status AS ENUM (
  'draft', 'active', 'paused', 'closed'
);

CREATE TYPE public.candidate_status AS ENUM (
  'active', 'stale', 'dismissed'
);

CREATE TABLE public.intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_principal_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',
  desired_stages public.opportunity_stage[] NOT NULL DEFAULT '{}',
  location_preference text,
  remote_ok boolean NOT NULL DEFAULT false,
  commitment_hours_per_week integer,
  deadline timestamptz,
  status public.intent_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_intent_title CHECK (length(trim(title)) BETWEEN 1 AND 160),
  CONSTRAINT chk_intent_description CHECK (length(trim(description)) BETWEEN 1 AND 10000),
  CONSTRAINT chk_intent_hours CHECK (
    commitment_hours_per_week IS NULL OR (commitment_hours_per_week BETWEEN 1 AND 40)
  )
);

CREATE INDEX idx_intents_owner_status ON public.intents (owner_principal_id, status);
CREATE INDEX idx_intents_status_deadline ON public.intents (deadline)
  WHERE status = 'active';
CREATE INDEX idx_intents_domains ON public.intents USING gin (domains);

ALTER TABLE public.intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY intents_function_all ON public.intents
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY intents_migrator_all ON public.intents
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY intents_owner_select ON public.intents
  FOR SELECT TO aven_app
  USING (owner_principal_id = app.current_principal_id());
ALTER TABLE public.intents FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.intents TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intents TO aven_function_owner;

CREATE TABLE public.match_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES public.intents (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities (id) ON DELETE CASCADE,
  algorithm_version text NOT NULL,
  score numeric(5,4),
  feature_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.candidate_status NOT NULL DEFAULT 'active',
  source_manifest_hash text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_match_score CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  CONSTRAINT uq_match_candidates_dedup UNIQUE (intent_id, opportunity_id, algorithm_version, source_manifest_hash)
);

CREATE INDEX idx_match_candidates_intent_status ON public.match_candidates (intent_id, status);
CREATE INDEX idx_match_candidates_opportunity_status ON public.match_candidates (opportunity_id, status);

ALTER TABLE public.match_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_candidates_function_all ON public.match_candidates
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY match_candidates_migrator_all ON public.match_candidates
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY match_candidates_owner_select ON public.match_candidates
  FOR SELECT TO aven_app
  USING (
    intent_id IN (
      SELECT id FROM public.intents WHERE owner_principal_id = app.current_principal_id()
    )
  );
ALTER TABLE public.match_candidates FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.match_candidates TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_candidates TO aven_function_owner;

-- Functions for Intents

CREATE OR REPLACE FUNCTION app.create_intent(
  p_title text,
  p_description text,
  p_domains text[] DEFAULT '{}',
  p_desired_stages public.opportunity_stage[] DEFAULT '{}',
  p_location_preference text DEFAULT NULL,
  p_remote_ok boolean DEFAULT false,
  p_commitment_hours_per_week integer DEFAULT NULL,
  p_deadline timestamptz DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  owner_principal_id uuid,
  title text,
  description text,
  domains text[],
  desired_stages public.opportunity_stage[],
  location_preference text,
  remote_ok boolean,
  commitment_hours_per_week integer,
  deadline timestamptz,
  status public.intent_status,
  version integer,
  created_at timestamptz,
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
  v_trimmed_title text := trim(p_title);
  v_trimmed_desc text := trim(p_description);
  v_domains text[] := coalesce(p_domains, '{}');
  v_desired_stages public.opportunity_stage[] := coalesce(p_desired_stages, '{}');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF length(v_trimmed_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid title length' USING ERRCODE = '22023';
  END IF;
  IF length(v_trimmed_desc) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid description length' USING ERRCODE = '22023';
  END IF;
  IF p_commitment_hours_per_week IS NOT NULL AND (p_commitment_hours_per_week < 1 OR p_commitment_hours_per_week > 40) THEN
    RAISE EXCEPTION 'invalid commitment hours' USING ERRCODE = '22023';
  END IF;
  IF p_deadline IS NOT NULL AND p_deadline <= clock_timestamp() THEN
    RAISE EXCEPTION 'deadline must be in future' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO public.intents (
    owner_principal_id,
    title,
    description,
    domains,
    desired_stages,
    location_preference,
    remote_ok,
    commitment_hours_per_week,
    deadline,
    status
  ) VALUES (
    v_user_id,
    v_trimmed_title,
    v_trimmed_desc,
    v_domains,
    v_desired_stages,
    trim(p_location_preference),
    coalesce(p_remote_ok, false),
    p_commitment_hours_per_week,
    p_deadline,
    'draft'
  )
  RETURNING
    intents.id,
    intents.owner_principal_id,
    intents.title,
    intents.description,
    intents.domains,
    intents.desired_stages,
    intents.location_preference,
    intents.remote_ok,
    intents.commitment_hours_per_week,
    intents.deadline,
    intents.status,
    intents.version,
    intents.created_at,
    intents.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_intent(
  p_intent_id uuid
) RETURNS TABLE (
  id uuid,
  owner_principal_id uuid,
  title text,
  description text,
  domains text[],
  desired_stages public.opportunity_stage[],
  location_preference text,
  remote_ok boolean,
  commitment_hours_per_week integer,
  deadline timestamptz,
  status public.intent_status,
  version integer,
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
  v_is_worker boolean := app.is_worker();
BEGIN
  IF v_user_id IS NULL AND NOT v_is_worker THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.owner_principal_id,
    i.title,
    i.description,
    i.domains,
    i.desired_stages,
    i.location_preference,
    i.remote_ok,
    i.commitment_hours_per_week,
    i.deadline,
    i.status,
    i.version,
    i.created_at,
    i.updated_at
  FROM public.intents i
  WHERE i.id = p_intent_id
    AND (v_is_worker OR i.owner_principal_id = v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.list_my_intents(
  p_status public.intent_status DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  owner_principal_id uuid,
  title text,
  description text,
  domains text[],
  desired_stages public.opportunity_stage[],
  location_preference text,
  remote_ok boolean,
  commitment_hours_per_week integer,
  deadline timestamptz,
  status public.intent_status,
  version integer,
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

  RETURN QUERY
  SELECT
    i.id,
    i.owner_principal_id,
    i.title,
    i.description,
    i.domains,
    i.desired_stages,
    i.location_preference,
    i.remote_ok,
    i.commitment_hours_per_week,
    i.deadline,
    i.status,
    i.version,
    i.created_at,
    i.updated_at
  FROM public.intents i
  WHERE i.owner_principal_id = v_user_id
    AND (p_status IS NULL OR i.status = p_status)
  ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.update_intent(
  p_intent_id uuid,
  p_title text,
  p_description text,
  p_domains text[],
  p_desired_stages public.opportunity_stage[],
  p_location_preference text,
  p_remote_ok boolean,
  p_commitment_hours_per_week integer,
  p_deadline timestamptz,
  p_expected_version integer
) RETURNS TABLE (
  id uuid,
  owner_principal_id uuid,
  title text,
  description text,
  domains text[],
  desired_stages public.opportunity_stage[],
  location_preference text,
  remote_ok boolean,
  commitment_hours_per_week integer,
  deadline timestamptz,
  status public.intent_status,
  version integer,
  created_at timestamptz,
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
  v_existing public.intents;
  v_trimmed_title text := trim(p_title);
  v_trimmed_desc text := trim(p_description);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_existing
  FROM public.intents
  WHERE intents.id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'intent not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_existing.owner_principal_id <> v_user_id THEN
    RAISE EXCEPTION 'not intent owner' USING ERRCODE = '42501';
  END IF;
  IF v_existing.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_existing.status = 'closed' THEN
    RAISE EXCEPTION 'cannot update closed intent' USING ERRCODE = '22023';
  END IF;

  IF p_title IS NOT NULL AND length(v_trimmed_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid title length' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NOT NULL AND length(v_trimmed_desc) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid description length' USING ERRCODE = '22023';
  END IF;
  IF p_commitment_hours_per_week IS NOT NULL AND (p_commitment_hours_per_week < 1 OR p_commitment_hours_per_week > 40) THEN
    RAISE EXCEPTION 'invalid commitment hours' USING ERRCODE = '22023';
  END IF;
  IF p_deadline IS NOT NULL AND p_deadline <= clock_timestamp() THEN
    RAISE EXCEPTION 'deadline must be in future' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.intents
  SET
    title = coalesce(v_trimmed_title, v_existing.title),
    description = coalesce(v_trimmed_desc, v_existing.description),
    domains = coalesce(p_domains, v_existing.domains),
    desired_stages = coalesce(p_desired_stages, v_existing.desired_stages),
    location_preference = CASE WHEN p_location_preference IS NOT NULL THEN trim(p_location_preference) ELSE v_existing.location_preference END,
    remote_ok = coalesce(p_remote_ok, v_existing.remote_ok),
    commitment_hours_per_week = coalesce(p_commitment_hours_per_week, v_existing.commitment_hours_per_week),
    deadline = CASE WHEN p_deadline IS NOT NULL THEN p_deadline ELSE v_existing.deadline END,
    version = v_existing.version + 1,
    updated_at = clock_timestamp()
  WHERE intents.id = p_intent_id
  RETURNING
    intents.id,
    intents.owner_principal_id,
    intents.title,
    intents.description,
    intents.domains,
    intents.desired_stages,
    intents.location_preference,
    intents.remote_ok,
    intents.commitment_hours_per_week,
    intents.deadline,
    intents.status,
    intents.version,
    intents.created_at,
    intents.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION app.set_intent_status(
  p_intent_id uuid,
  p_new_status public.intent_status,
  p_expected_version integer
) RETURNS TABLE (
  id uuid,
  owner_principal_id uuid,
  status public.intent_status,
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
  v_existing public.intents;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_existing
  FROM public.intents
  WHERE intents.id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'intent not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_existing.owner_principal_id <> v_user_id THEN
    RAISE EXCEPTION 'not intent owner' USING ERRCODE = '42501';
  END IF;
  IF v_existing.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_existing.status = p_new_status THEN
    RETURN QUERY SELECT v_existing.id, v_existing.owner_principal_id, v_existing.status, v_existing.version, v_existing.updated_at;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.intents
  SET
    status = p_new_status,
    version = v_existing.version + 1,
    updated_at = clock_timestamp()
  WHERE intents.id = p_intent_id
  RETURNING
    intents.id,
    intents.owner_principal_id,
    intents.status,
    intents.version,
    intents.updated_at;
END;
$$;

-- Matching Candidates Generation
CREATE OR REPLACE FUNCTION app.generate_match_candidates(
  p_intent_id uuid,
  p_algorithm_version text DEFAULT 'v1-baseline'
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_is_worker boolean := app.is_worker();
  v_intent public.intents;
  v_user_campuses uuid[];
  v_opp record;
  v_inserted_count integer := 0;
  v_score numeric(5,4);
  v_feature_scores jsonb;
  v_reasons jsonb;
  v_evidence jsonb;
  v_manifest_hash text;
  v_shared_domains text[];
  v_domain_score numeric(5,4) := 0;
  v_stage_score numeric(5,4) := 0;
  v_remote_score numeric(5,4) := 0;
BEGIN
  IF v_user_id IS NULL AND NOT v_is_worker THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_intent
  FROM public.intents
  WHERE intents.id = p_intent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'intent not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_worker AND v_intent.owner_principal_id <> v_user_id THEN
    RAISE EXCEPTION 'not intent owner' USING ERRCODE = '42501';
  END IF;

  -- Read active verified campus IDs of the intent owner
  SELECT coalesce(array_agg(campus_id), '{}') INTO v_user_campuses
  FROM public.campus_memberships
  WHERE user_id = v_intent.owner_principal_id
    AND status = 'verified';

  -- Scan eligible opportunities:
  -- 1. status = 'open'
  -- 2. deadline is null or in future
  -- 3. visibility check: public, or campus if user has verified membership in that campus
  FOR v_opp IN
    SELECT
      o.id,
      o.title,
      o.domains,
      o.stage,
      o.remote_ok,
      o.commitment_hours_per_week,
      o.deadline,
      o.visibility,
      org.campus_id AS org_campus_id,
      p.display_name AS org_name
    FROM public.opportunities o
    JOIN public.organizations org ON org.id = o.organization_id
    JOIN public.principals p ON p.id = org.id
    WHERE o.status = 'open'
      AND (o.deadline IS NULL OR o.deadline > clock_timestamp())
      AND (
        o.visibility = 'public'
        OR (o.visibility = 'campus' AND (org.campus_id = ANY(v_user_campuses) OR app.is_org_member(org.id)))
      )
  LOOP
    -- Calculate domain overlap
    SELECT coalesce(array_agg(d), '{}') INTO v_shared_domains
    FROM unnest(v_intent.domains) d
    WHERE d = ANY(v_opp.domains);

    IF array_length(v_shared_domains, 1) > 0 THEN
      v_domain_score := least(1.0, array_length(v_shared_domains, 1)::numeric / greatest(1, array_length(v_intent.domains, 1))::numeric);
    ELSE
      v_domain_score := 0.1;
    END IF;

    -- Stage match
    IF v_opp.stage = 'any' OR (array_length(v_intent.desired_stages, 1) IS NOT NULL AND v_opp.stage = ANY(v_intent.desired_stages)) THEN
      v_stage_score := 1.0;
    ELSE
      v_stage_score := 0.3;
    END IF;

    -- Remote match
    IF v_intent.remote_ok AND v_opp.remote_ok THEN
      v_remote_score := 1.0;
    ELSIF NOT v_intent.remote_ok AND NOT v_opp.remote_ok THEN
      v_remote_score := 0.8;
    ELSE
      v_remote_score := 0.5;
    END IF;

    -- Total score
    v_score := round((v_domain_score * 0.5 + v_stage_score * 0.3 + v_remote_score * 0.2)::numeric, 4);

    v_feature_scores := jsonb_build_object(
      'domain_score', v_domain_score,
      'stage_score', v_stage_score,
      'remote_score', v_remote_score
    );

    v_reasons := jsonb_build_array();
    IF array_length(v_shared_domains, 1) > 0 THEN
      v_reasons := v_reasons || jsonb_build_object(
        'type', 'domain_overlap',
        'description', '共同研究领域：' || array_to_string(v_shared_domains, '、')
      );
    END IF;
    IF v_stage_score = 1.0 THEN
      v_reasons := v_reasons || jsonb_build_object(
        'type', 'stage_match',
        'description', '学历与培养阶段完全契合'
      );
    END IF;
    IF v_opp.remote_ok THEN
      v_reasons := v_reasons || jsonb_build_object(
        'type', 'remote_friendly',
        'description', '支持远程协同参与'
      );
    END IF;

    v_evidence := jsonb_build_array(
      jsonb_build_object(
        'source', 'intent',
        'intent_id', v_intent.id,
        'intent_version', v_intent.version,
        'matched_domains', v_shared_domains
      ),
      jsonb_build_object(
        'source', 'opportunity',
        'opportunity_id', v_opp.id,
        'stage', v_opp.stage,
        'remote_ok', v_opp.remote_ok
      )
    );

    v_manifest_hash := md5(
      v_intent.id::text || ':' || v_intent.version::text || ':' ||
      v_opp.id::text || ':' || p_algorithm_version
    );

    INSERT INTO public.match_candidates (
      intent_id,
      opportunity_id,
      algorithm_version,
      score,
      feature_scores,
      reasons,
      evidence,
      status,
      source_manifest_hash,
      computed_at,
      expires_at
    ) VALUES (
      v_intent.id,
      v_opp.id,
      p_algorithm_version,
      v_score,
      v_feature_scores,
      v_reasons,
      v_evidence,
      'active',
      v_manifest_hash,
      clock_timestamp(),
      clock_timestamp() + interval '30 days'
    )
    ON CONFLICT (intent_id, opportunity_id, algorithm_version, source_manifest_hash)
    DO UPDATE SET
      score = EXCLUDED.score,
      feature_scores = EXCLUDED.feature_scores,
      reasons = EXCLUDED.reasons,
      evidence = EXCLUDED.evidence,
      status = 'active',
      computed_at = EXCLUDED.computed_at,
      version = match_candidates.version + 1;

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  RETURN v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_candidates_for_intent(
  p_intent_id uuid
) RETURNS TABLE (
  candidate_id uuid,
  intent_id uuid,
  opportunity_id uuid,
  opportunity_title text,
  opportunity_summary text,
  organization_name text,
  stage public.opportunity_stage,
  score numeric(5,4),
  feature_scores jsonb,
  reasons jsonb,
  evidence jsonb,
  status public.candidate_status,
  computed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_intent public.intents;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_intent
  FROM public.intents
  WHERE intents.id = p_intent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'intent not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_intent.owner_principal_id <> v_user_id THEN
    RAISE EXCEPTION 'not intent owner' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    mc.id AS candidate_id,
    mc.intent_id,
    mc.opportunity_id,
    o.title AS opportunity_title,
    o.summary AS opportunity_summary,
    p.display_name AS organization_name,
    o.stage,
    mc.score,
    mc.feature_scores,
    mc.reasons,
    mc.evidence,
    mc.status,
    mc.computed_at
  FROM public.match_candidates mc
  JOIN public.opportunities o ON o.id = mc.opportunity_id
  JOIN public.organizations org ON org.id = o.organization_id
  JOIN public.principals p ON p.id = org.id
  WHERE mc.intent_id = p_intent_id
    AND mc.status = 'active'
    AND o.status = 'open'
    AND (o.deadline IS NULL OR o.deadline > clock_timestamp())
  ORDER BY mc.score DESC, mc.computed_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.dismiss_candidate(
  p_candidate_id uuid
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_intent_owner uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT i.owner_principal_id INTO v_intent_owner
  FROM public.match_candidates mc
  JOIN public.intents i ON i.id = mc.intent_id
  WHERE mc.id = p_candidate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_intent_owner <> v_user_id THEN
    RAISE EXCEPTION 'not candidate owner' USING ERRCODE = '42501';
  END IF;

  UPDATE public.match_candidates
  SET
    status = 'dismissed',
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = p_candidate_id;

  RETURN true;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.create_intent(text, text, text[], public.opportunity_stage[], text, boolean, integer, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_intent(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_intents(public.intent_status) OWNER TO aven_function_owner;
ALTER FUNCTION app.update_intent(uuid, text, text, text[], public.opportunity_stage[], text, boolean, integer, timestamptz, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.set_intent_status(uuid, public.intent_status, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.generate_match_candidates(uuid, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_candidates_for_intent(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.dismiss_candidate(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_intent FROM public;
REVOKE ALL ON FUNCTION app.get_intent FROM public;
REVOKE ALL ON FUNCTION app.list_my_intents FROM public;
REVOKE ALL ON FUNCTION app.update_intent FROM public;
REVOKE ALL ON FUNCTION app.set_intent_status FROM public;
REVOKE ALL ON FUNCTION app.generate_match_candidates FROM public;
REVOKE ALL ON FUNCTION app.list_candidates_for_intent FROM public;
REVOKE ALL ON FUNCTION app.dismiss_candidate FROM public;

GRANT EXECUTE ON FUNCTION app.create_intent TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_intent TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.list_my_intents TO aven_app;
GRANT EXECUTE ON FUNCTION app.update_intent TO aven_app;
GRANT EXECUTE ON FUNCTION app.set_intent_status TO aven_app;
GRANT EXECUTE ON FUNCTION app.generate_match_candidates TO aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.list_candidates_for_intent TO aven_app;
GRANT EXECUTE ON FUNCTION app.dismiss_candidate TO aven_app;
