-- Migration: 0038_referral_supplements
-- M5-04: Referral Supplements, Content Versioning, and Expiration Maintenance

CREATE TABLE public.referral_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals (id) ON DELETE CASCADE,
  supplement_version integer NOT NULL,
  author_user_id uuid NOT NULL REFERENCES public.users (id),
  content text NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_referral_supplement_ver UNIQUE (referral_id, supplement_version)
);

CREATE INDEX idx_referral_supplements_ref ON public.referral_supplements (referral_id, supplement_version ASC);

ALTER TABLE public.referral_supplements ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_supplements_function_all ON public.referral_supplements
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY referral_supplements_migrator_all ON public.referral_supplements
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY referral_supplements_participant_select ON public.referral_supplements
  FOR SELECT TO aven_app
  USING (
    referral_id IN (
      SELECT id FROM public.referrals
      WHERE applicant_user_id = app.current_user_id()
         OR organization_id = app.current_principal_id()
         OR app.is_org_member(organization_id)
    )
  );
ALTER TABLE public.referral_supplements FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.referral_supplements TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_supplements TO aven_function_owner;

CREATE OR REPLACE FUNCTION app.submit_referral_supplement(
  p_referral_id uuid,
  p_content text,
  p_expected_version integer
) RETURNS TABLE (
  supplement_id uuid,
  referral_id uuid,
  supplement_version integer,
  content text,
  new_status public.referral_status,
  new_content_version integer,
  new_version integer,
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
  v_ref public.referrals;
  v_next_sup_ver integer;
  v_new_content_ver integer;
  v_new_ver integer;
  v_sup_id uuid;
  v_now timestamptz := clock_timestamp();
  v_trimmed text := trim(p_content);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF v_trimmed IS NULL OR char_length(v_trimmed) < 1 OR char_length(v_trimmed) > 4000 THEN
    RAISE EXCEPTION 'supplement content must be between 1 and 4000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ref
  FROM public.referrals
  WHERE referrals.id = p_referral_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_ref.applicant_user_id <> v_user_id THEN
    RAISE EXCEPTION 'not authorized to supplement referral' USING ERRCODE = '42501';
  END IF;

  IF v_ref.version <> p_expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = '40001';
  END IF;

  IF v_ref.status IN ('declined', 'withdrawn', 'expired', 'accepted') THEN
    RAISE EXCEPTION 'referral is in terminal state' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(rs.supplement_version), 0) + 1 INTO v_next_sup_ver
  FROM public.referral_supplements rs
  WHERE rs.referral_id = p_referral_id;

  v_new_content_ver := v_ref.content_version + 1;
  v_new_ver := v_ref.version + 1;

  INSERT INTO public.referral_supplements (
    referral_id,
    supplement_version,
    author_user_id,
    content,
    created_at
  ) VALUES (
    p_referral_id,
    v_next_sup_ver,
    v_user_id,
    v_trimmed,
    v_now
  ) RETURNING public.referral_supplements.id INTO v_sup_id;

  UPDATE public.referrals
  SET
    status = 'sent',
    content_version = v_new_content_ver,
    version = v_new_ver,
    updated_at = v_now
  WHERE id = p_referral_id;

  -- Reset org decision to pending for the new content version
  UPDATE public.referral_decisions
  SET
    decision = 'pending',
    reason = NULL,
    referral_content_version = v_new_content_ver,
    decided_at = NULL,
    version = referral_decisions.version + 1,
    updated_at = v_now
  WHERE referral_decisions.referral_id = p_referral_id AND referral_decisions.side = 'organization';

  RETURN QUERY
  SELECT
    v_sup_id,
    p_referral_id,
    v_next_sup_ver,
    v_trimmed,
    'sent'::public.referral_status,
    v_new_content_ver,
    v_new_ver,
    v_now;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_referral_supplements(
  p_referral_id uuid
) RETURNS TABLE (
  id uuid,
  referral_id uuid,
  supplement_version integer,
  author_user_id uuid,
  content text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ref public.referrals;
BEGIN
  SELECT * INTO v_ref
  FROM public.referrals
  WHERE referrals.id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_ref.applicant_user_id = app.current_user_id()
    OR v_ref.organization_id = app.current_principal_id()
    OR app.is_org_member(v_ref.organization_id)
  ) THEN
    RAISE EXCEPTION 'not authorized to view referral supplements' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    rs.id,
    rs.referral_id,
    rs.supplement_version,
    rs.author_user_id,
    rs.content,
    rs.created_at
  FROM public.referral_supplements rs
  WHERE rs.referral_id = p_referral_id
  ORDER BY rs.supplement_version ASC;
END;
$$;

CREATE OR REPLACE FUNCTION app.maintain_referrals(
  p_batch_size integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_batch_size, 100), 1), 1000);
  v_expired_referrals integer := 0;
  v_expired_grants integer := 0;
BEGIN
  IF session_user <> 'aven_worker' THEN
    RAISE EXCEPTION 'maintenance functions may only be executed by worker' USING ERRCODE = '42501';
  END IF;

  WITH expired_refs AS (
    SELECT id
    FROM public.referrals
    WHERE status IN ('sent', 'info_requested')
      AND expires_at <= clock_timestamp()
    LIMIT v_limit
  ),
  updated_refs AS (
    UPDATE public.referrals r
    SET
      status = 'expired',
      version = r.version + 1,
      updated_at = clock_timestamp()
    FROM expired_refs
    WHERE r.id = expired_refs.id
    RETURNING r.id
  )
  SELECT count(*) INTO v_expired_referrals FROM updated_refs;

  WITH expired_grants AS (
    SELECT id
    FROM public.consent_grants
    WHERE status = 'active'
      AND expires_at <= clock_timestamp()
    LIMIT v_limit
  ),
  updated_grants AS (
    UPDATE public.consent_grants g
    SET
      status = 'expired',
      version = g.version + 1,
      updated_at = clock_timestamp()
    FROM expired_grants
    WHERE g.id = expired_grants.id
    RETURNING g.id
  )
  SELECT count(*) INTO v_expired_grants FROM updated_grants;

  RETURN jsonb_build_object(
    'expiredReferralsCount', v_expired_referrals,
    'expiredGrantsCount', v_expired_grants
  );
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.submit_referral_supplement(uuid, text, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_referral_supplements(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.maintain_referrals(integer) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.submit_referral_supplement(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_referral_supplements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.maintain_referrals(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.submit_referral_supplement(uuid, text, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_referral_supplements(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.maintain_referrals(integer) TO aven_worker;
