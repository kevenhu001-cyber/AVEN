-- Migration: 0029_availability_sharing.sql
-- M6-01R: Purpose-bound availability sharing with expiry and revocation.

-- 1) Grant a grantee principal the right to read the grantor's busy/free projection.
CREATE OR REPLACE FUNCTION app.create_availability_share(
  p_grantee_principal_id uuid,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_principal_id uuid := app.current_principal_id();
  v_grantee public.principals;
  v_grant public.consent_grants;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR v_principal_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF p_grantee_principal_id IS NULL THEN
    RAISE EXCEPTION 'grantee is required' USING ERRCODE = '22023';
  END IF;

  IF p_grantee_principal_id = v_principal_id THEN
    RAISE EXCEPTION 'cannot share availability with self' USING ERRCODE = '22023';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RAISE EXCEPTION 'expires_at must be in the future' USING ERRCODE = '22023';
  END IF;

  IF p_expires_at > v_now + interval '90 days' THEN
    RAISE EXCEPTION 'expires_at exceeds the maximum share horizon' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_grantee
  FROM public.principals
  WHERE principals.id = p_grantee_principal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'grantee principal not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_grantee.status <> 'active' THEN
    RAISE EXCEPTION 'grantee principal is not active' USING ERRCODE = '22023';
  END IF;

  IF v_grantee.type NOT IN ('user', 'organization') THEN
    RAISE EXCEPTION 'grantee principal type is not shareable' USING ERRCODE = '22023';
  END IF;

  -- One active share per (grantor, grantee, purpose).
  IF EXISTS (
    SELECT 1
    FROM public.consent_grants cg
    WHERE cg.grantor_principal_id = v_principal_id
      AND cg.grantee_principal_id = p_grantee_principal_id
      AND cg.purpose = 'event_coordination'
      AND cg.status = 'active'
      AND cg.expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'an active availability share already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.consent_grants (
    grantor_principal_id,
    grantee_principal_id,
    purpose,
    status,
    expires_at
  ) VALUES (
    v_principal_id,
    p_grantee_principal_id,
    'event_coordination',
    'active',
    p_expires_at
  )
  RETURNING * INTO v_grant;

  INSERT INTO public.consent_events (
    grant_id,
    event_type,
    actor_principal_id,
    metadata
  ) VALUES (
    v_grant.id,
    'granted',
    v_principal_id,
    jsonb_build_object(
      'purpose', 'event_coordination',
      'kind', 'availability_share',
      'grantee_principal_id', p_grantee_principal_id
    )
  );

  RETURN jsonb_build_object(
    'id', v_grant.id,
    'grantorPrincipalId', v_grant.grantor_principal_id,
    'granteePrincipalId', v_grant.grantee_principal_id,
    'purpose', v_grant.purpose,
    'status', v_grant.status,
    'expiresAt', v_grant.expires_at,
    'version', v_grant.version,
    'createdAt', v_grant.created_at
  );
END;
$$;

-- 2) List shares granted by or received by the current user.
CREATE OR REPLACE FUNCTION app.list_availability_shares()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_principal_id uuid := app.current_principal_id();
BEGIN
  IF v_user_id IS NULL OR v_principal_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', cg.id,
        'grantorPrincipalId', cg.grantor_principal_id,
        'granteePrincipalId', cg.grantee_principal_id,
        'purpose', cg.purpose,
        'status', cg.status,
        'expiresAt', cg.expires_at,
        'version', cg.version,
        'createdAt', cg.created_at,
        'direction', CASE
          WHEN cg.grantor_principal_id = v_principal_id THEN 'granted'
          ELSE 'received'
        END
      )
      ORDER BY cg.created_at DESC
    )
    FROM public.consent_grants cg
    WHERE cg.purpose = 'event_coordination'
      AND cg.referral_id IS NULL
      AND cg.event_id IS NULL
      AND (
        cg.grantor_principal_id = v_principal_id
        OR cg.grantee_principal_id = v_principal_id
        OR app.is_org_member(cg.grantee_principal_id)
      )
  ), '[]'::jsonb);
END;
$$;

-- 3) Revoke a share (grantor only).
CREATE OR REPLACE FUNCTION app.revoke_availability_share(
  p_grant_id uuid
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_principal_id uuid := app.current_principal_id();
  v_grant public.consent_grants;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR v_principal_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_grant
  FROM public.consent_grants
  WHERE consent_grants.id = p_grant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'availability share not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_grant.purpose <> 'event_coordination'
     OR v_grant.referral_id IS NOT NULL
     OR v_grant.event_id IS NOT NULL THEN
    RAISE EXCEPTION 'grant is not an availability share' USING ERRCODE = '22023';
  END IF;

  IF v_grant.grantor_principal_id <> v_principal_id THEN
    RAISE EXCEPTION 'only the grantor can revoke an availability share' USING ERRCODE = '42501';
  END IF;

  IF v_grant.status = 'revoked' THEN
    RETURN true; -- Idempotent
  END IF;

  UPDATE public.consent_grants
  SET
    status = 'revoked',
    revoked_at = v_now,
    revoked_by = v_principal_id,
    revoke_reason = 'Availability share revoked by owner',
    version = version + 1,
    updated_at = v_now
  WHERE id = p_grant_id;

  INSERT INTO public.consent_events (
    grant_id,
    event_type,
    actor_principal_id,
    metadata
  ) VALUES (
    p_grant_id,
    'revoked',
    v_principal_id,
    jsonb_build_object('purpose', 'event_coordination', 'kind', 'availability_share')
  );

  RETURN true;
END;
$$;

-- 4) Availability projection: self is always allowed; another principal requires an
--    active, unexpired availability share granted by that principal to the caller.
CREATE OR REPLACE FUNCTION app.query_availability_window(
  p_principal_ids uuid[],
  p_start_at timestamptz,
  p_end_at timestamptz
) RETURNS TABLE (
  principal_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status public.availability_status
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_principal_id uuid := app.current_principal_id();
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR v_principal_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'end_at must be strictly after start_at' USING ERRCODE = '22023';
  END IF;

  IF p_principal_ids IS NULL OR cardinality(p_principal_ids) = 0 THEN
    RAISE EXCEPTION 'principal_ids is required' USING ERRCODE = '22023';
  END IF;

  -- Fail closed: every requested principal must be the caller or hold a valid share.
  IF EXISTS (
    SELECT 1
    FROM unnest(p_principal_ids) AS requested(id)
    WHERE requested.id IS NULL
       OR (
         requested.id <> v_principal_id
         AND NOT EXISTS (
           SELECT 1
           FROM public.consent_grants cg
           WHERE cg.grantor_principal_id = requested.id
             AND cg.purpose = 'event_coordination'
             AND cg.referral_id IS NULL
             AND cg.event_id IS NULL
             AND cg.status = 'active'
             AND cg.expires_at > v_now
             AND (
               cg.grantee_principal_id = v_principal_id
               OR app.is_org_member(cg.grantee_principal_id)
             )
         )
       )
  ) THEN
    RAISE EXCEPTION 'availability access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ab.principal_id,
    greatest(ab.start_at, p_start_at) AS start_at,
    least(ab.end_at, p_end_at) AS end_at,
    ab.status
  FROM public.availability_blocks ab
  WHERE ab.principal_id = ANY(p_principal_ids)
    AND ab.start_at < p_end_at
    AND ab.end_at > p_start_at
  ORDER BY ab.start_at ASC;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.create_availability_share(uuid, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_availability_shares() OWNER TO aven_function_owner;
ALTER FUNCTION app.revoke_availability_share(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.query_availability_window(uuid[], timestamptz, timestamptz) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_availability_share(uuid, timestamptz) FROM public;
REVOKE ALL ON FUNCTION app.list_availability_shares() FROM public;
REVOKE ALL ON FUNCTION app.revoke_availability_share(uuid) FROM public;
REVOKE ALL ON FUNCTION app.query_availability_window(uuid[], timestamptz, timestamptz) FROM public;

GRANT EXECUTE ON FUNCTION app.create_availability_share(uuid, timestamptz) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_availability_shares() TO aven_app;
GRANT EXECUTE ON FUNCTION app.revoke_availability_share(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.query_availability_window(uuid[], timestamptz, timestamptz) TO aven_app;
