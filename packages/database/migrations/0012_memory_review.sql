-- M3-02: memory review.
-- Adds pending candidates, accept/modify/reject transitions, and an explicit
-- retrieval gate so only confirmed memories with an allowed use are returned.

CREATE UNIQUE INDEX uq_memory_pending_candidate
  ON public.memory_items (owner_principal_id, kind, title, content)
  WHERE status = 'pending_confirmation';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_memory_source_excerpt'
      AND conrelid = 'public.memory_sources'::regclass
  ) THEN
    ALTER TABLE public.memory_sources
      ADD CONSTRAINT chk_memory_source_excerpt
      CHECK (excerpt IS NULL OR length(excerpt) <= 2000);
  END IF;
END;
$$;

-- The main memory list is the user's confirmed context. Pending candidates are
-- reviewed through app.list_memory_candidates; rejected items stay hidden.
CREATE OR REPLACE FUNCTION app.list_my_memory_items(
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_kind public.memory_kind
)
RETURNS TABLE (
  id uuid,
  kind public.memory_kind,
  title text,
  content text,
  structured_value jsonb,
  sensitivity public.sensitivity,
  status public.memory_status,
  version integer,
  valid_from timestamptz,
  valid_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  display_audience public.display_audience,
  discoverable boolean,
  allowed_uses text[],
  campus_id uuid,
  policy_version integer,
  source_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT m.id, m.kind, m.title, m.content, m.structured_value, m.sensitivity,
         m.status, m.version, m.valid_from, m.valid_until, m.confirmed_at,
         m.created_at, m.updated_at,
         coalesce(p.display_audience, 'owner'),
         coalesce(p.discoverable, false),
         coalesce(p.allowed_uses, '{}'::public.context_use[])::text[],
         p.campus_id,
         coalesce(p.version, 0),
         (SELECT count(*)::integer FROM public.memory_sources s WHERE s.memory_item_id = m.id)
  FROM public.memory_items m
  LEFT JOIN public.context_field_policies p
    ON p.source_type = 'memory_item' AND p.source_id = m.id AND p.field_key = 'content'
  WHERE m.owner_principal_id = v_user_id
    AND m.status = 'confirmed'
    AND m.deleted_at IS NULL
    AND (p_kind IS NULL OR m.kind = p_kind)
    AND (
      p_cursor_created_at IS NULL
      OR (m.created_at, m.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT v_limit + 1;
END;
$$;

-- Pending candidates can be edited before confirmation, but rejected and
-- expired items are not editable through the normal update path.
CREATE OR REPLACE FUNCTION app.update_memory_item(
  p_id uuid,
  p_expected_version integer,
  p_title text,
  p_content text,
  p_structured_value jsonb,
  p_sensitivity public.sensitivity,
  p_display_audience public.display_audience,
  p_discoverable boolean,
  p_allowed_uses public.context_use[],
  p_campus_id uuid,
  p_valid_until timestamptz
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_new_version integer;
  v_campus_status text;
  v_uses public.context_use[] := coalesce(p_allowed_uses, '{}');
  v_distinct_uses integer;
  v_discoverable boolean := coalesce(p_discoverable, false);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid memory title' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'invalid memory content' USING ERRCODE = '22023';
  END IF;
  IF p_sensitivity IS NULL OR p_display_audience IS NULL THEN
    RAISE EXCEPTION 'invalid memory policy' USING ERRCODE = '22023';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= now() THEN
    RAISE EXCEPTION 'invalid memory validity' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT u) INTO v_distinct_uses FROM unnest(v_uses) AS u;
  IF v_distinct_uses <> coalesce(array_length(v_uses, 1), 0) THEN
    RAISE EXCEPTION 'duplicate memory uses' USING ERRCODE = '22023';
  END IF;
  IF p_display_audience = 'campus' THEN
    IF p_campus_id IS NULL THEN
      RAISE EXCEPTION 'campus audience requires a campus' USING ERRCODE = '22023';
    END IF;
    SELECT c.status INTO v_campus_status FROM public.campuses c WHERE c.id = p_campus_id;
    IF v_campus_status IS NULL OR v_campus_status <> 'active' THEN
      RAISE EXCEPTION 'campus not available' USING ERRCODE = '22023';
    END IF;
  ELSIF p_campus_id IS NOT NULL THEN
    RAISE EXCEPTION 'campus id requires campus audience' USING ERRCODE = '22023';
  END IF;
  IF v_discoverable AND p_display_audience = 'owner' THEN
    RAISE EXCEPTION 'owner-only memory cannot be discoverable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.memory_items
  SET title = trim(p_title),
      content = p_content,
      structured_value = p_structured_value,
      sensitivity = p_sensitivity,
      valid_until = p_valid_until,
      version = version + 1,
      updated_at = now()
  WHERE id = p_id
    AND owner_principal_id = v_user_id
    AND version = p_expected_version
    AND status IN ('pending_confirmation', 'confirmed')
  RETURNING version INTO v_new_version;
  IF v_new_version IS NULL THEN
    RAISE EXCEPTION 'memory version conflict or not editable' USING ERRCODE = '23514';
  END IF;
  UPDATE public.context_field_policies
  SET display_audience = p_display_audience,
      campus_id = p_campus_id,
      discoverable = v_discoverable,
      allowed_uses = v_uses,
      version = version + 1,
      updated_at = now()
  WHERE source_type = 'memory_item' AND source_id = p_id AND field_key = 'content';
  IF NOT FOUND THEN
    INSERT INTO public.context_field_policies
      (owner_principal_id, source_type, source_id, field_key, display_audience,
       campus_id, discoverable, allowed_uses)
    VALUES
      (v_user_id, 'memory_item', p_id, 'content', p_display_audience,
       p_campus_id, v_discoverable, v_uses);
  END IF;
  RETURN v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION app.create_memory_candidate(
  p_kind public.memory_kind,
  p_title text,
  p_content text,
  p_structured_value jsonb,
  p_sensitivity public.sensitivity,
  p_source_type public.memory_source_type,
  p_source_id uuid,
  p_source_version text,
  p_excerpt text
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_memory_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'invalid memory kind' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid memory title' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'invalid memory content' USING ERRCODE = '22023';
  END IF;
  IF p_sensitivity IS NULL THEN
    RAISE EXCEPTION 'invalid memory sensitivity' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NULL
     OR p_source_type NOT IN ('conversation', 'file', 'import', 'agent_extraction') THEN
    RAISE EXCEPTION 'invalid memory source type' USING ERRCODE = '22023';
  END IF;
  IF p_source_version IS NOT NULL AND length(p_source_version) > 120 THEN
    RAISE EXCEPTION 'invalid memory source version' USING ERRCODE = '22023';
  END IF;
  IF p_excerpt IS NOT NULL AND length(p_excerpt) > 2000 THEN
    RAISE EXCEPTION 'invalid memory source excerpt' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.memory_items
    (owner_principal_id, kind, title, content, structured_value, sensitivity, status)
  VALUES
    (v_user_id, p_kind, trim(p_title), p_content, p_structured_value, p_sensitivity,
     'pending_confirmation')
  ON CONFLICT (owner_principal_id, kind, title, content)
    WHERE status = 'pending_confirmation'
  DO NOTHING
  RETURNING id INTO v_memory_id;
  IF v_memory_id IS NULL THEN
    SELECT m.id INTO v_memory_id
    FROM public.memory_items m
    WHERE m.owner_principal_id = v_user_id
      AND m.kind = p_kind
      AND m.title = trim(p_title)
      AND m.content = p_content
      AND m.status = 'pending_confirmation'
    LIMIT 1;
    RETURN v_memory_id;
  END IF;
  INSERT INTO public.memory_sources
    (memory_item_id, source_type, source_id, source_version, excerpt)
  VALUES
    (v_memory_id, p_source_type, p_source_id, p_source_version, p_excerpt);
  INSERT INTO public.context_field_policies
    (owner_principal_id, source_type, source_id, field_key, display_audience,
     campus_id, discoverable, allowed_uses)
  VALUES
    (v_user_id, 'memory_item', v_memory_id, 'content', 'owner', null, false, '{}');
  RETURN v_memory_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.confirm_memory_item(
  p_id uuid,
  p_expected_version integer,
  p_kind public.memory_kind,
  p_title text,
  p_content text,
  p_structured_value jsonb,
  p_sensitivity public.sensitivity,
  p_display_audience public.display_audience,
  p_discoverable boolean,
  p_allowed_uses public.context_use[],
  p_campus_id uuid,
  p_valid_until timestamptz
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_new_version integer;
  v_campus_status text;
  v_uses public.context_use[] := coalesce(p_allowed_uses, '{}');
  v_distinct_uses integer;
  v_discoverable boolean := coalesce(p_discoverable, false);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_kind IS NULL OR p_sensitivity IS NULL OR p_display_audience IS NULL THEN
    RAISE EXCEPTION 'invalid memory policy' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid memory title' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'invalid memory content' USING ERRCODE = '22023';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= now() THEN
    RAISE EXCEPTION 'invalid memory validity' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT u) INTO v_distinct_uses FROM unnest(v_uses) AS u;
  IF v_distinct_uses <> coalesce(array_length(v_uses, 1), 0) THEN
    RAISE EXCEPTION 'duplicate memory uses' USING ERRCODE = '22023';
  END IF;
  IF p_display_audience = 'campus' THEN
    IF p_campus_id IS NULL THEN
      RAISE EXCEPTION 'campus audience requires a campus' USING ERRCODE = '22023';
    END IF;
    SELECT c.status INTO v_campus_status FROM public.campuses c WHERE c.id = p_campus_id;
    IF v_campus_status IS NULL OR v_campus_status <> 'active' THEN
      RAISE EXCEPTION 'campus not available' USING ERRCODE = '22023';
    END IF;
  ELSIF p_campus_id IS NOT NULL THEN
    RAISE EXCEPTION 'campus id requires campus audience' USING ERRCODE = '22023';
  END IF;
  IF v_discoverable AND p_display_audience = 'owner' THEN
    RAISE EXCEPTION 'owner-only memory cannot be discoverable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.memory_items
  SET kind = p_kind,
      title = trim(p_title),
      content = p_content,
      structured_value = p_structured_value,
      sensitivity = p_sensitivity,
      status = 'confirmed',
      valid_from = coalesce(valid_from, now()),
      valid_until = p_valid_until,
      confirmed_at = now(),
      version = version + 1,
      updated_at = now()
  WHERE id = p_id
    AND owner_principal_id = v_user_id
    AND version = p_expected_version
    AND status = 'pending_confirmation'
  RETURNING version INTO v_new_version;
  IF v_new_version IS NULL THEN
    RAISE EXCEPTION 'memory version conflict or not pending' USING ERRCODE = '23514';
  END IF;
  UPDATE public.context_field_policies
  SET display_audience = p_display_audience,
      campus_id = p_campus_id,
      discoverable = v_discoverable,
      allowed_uses = v_uses,
      version = version + 1,
      updated_at = now()
  WHERE source_type = 'memory_item' AND source_id = p_id AND field_key = 'content';
  IF NOT FOUND THEN
    INSERT INTO public.context_field_policies
      (owner_principal_id, source_type, source_id, field_key, display_audience,
       campus_id, discoverable, allowed_uses)
    VALUES
      (v_user_id, 'memory_item', p_id, 'content', p_display_audience,
       p_campus_id, v_discoverable, v_uses);
  END IF;
  RETURN v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION app.reject_memory_item(
  p_id uuid,
  p_expected_version integer
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_new_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  UPDATE public.memory_items
  SET status = 'rejected', version = version + 1, updated_at = now()
  WHERE id = p_id
    AND owner_principal_id = v_user_id
    AND version = p_expected_version
    AND status = 'pending_confirmation'
  RETURNING version INTO v_new_version;
  IF v_new_version IS NULL THEN
    RAISE EXCEPTION 'memory version conflict or not pending' USING ERRCODE = '23514';
  END IF;
  UPDATE public.context_field_policies
  SET allowed_uses = '{}', discoverable = false, version = version + 1, updated_at = now()
  WHERE source_type = 'memory_item' AND source_id = p_id;
  RETURN v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_memory_candidates(
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid
)
RETURNS TABLE (
  id uuid,
  kind public.memory_kind,
  title text,
  content text,
  structured_value jsonb,
  sensitivity public.sensitivity,
  status public.memory_status,
  version integer,
  valid_from timestamptz,
  valid_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  display_audience public.display_audience,
  discoverable boolean,
  allowed_uses text[],
  campus_id uuid,
  policy_version integer,
  source_count integer,
  source_record_id uuid,
  source_type public.memory_source_type,
  source_ref_id uuid,
  source_version text,
  source_excerpt text,
  source_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT m.id, m.kind, m.title, m.content, m.structured_value, m.sensitivity,
         m.status, m.version, m.valid_from, m.valid_until, m.confirmed_at,
         m.created_at, m.updated_at,
         coalesce(p.display_audience, 'owner'),
         coalesce(p.discoverable, false),
         coalesce(p.allowed_uses, '{}'::public.context_use[])::text[],
         p.campus_id,
         coalesce(p.version, 0),
         (SELECT count(*)::integer FROM public.memory_sources s WHERE s.memory_item_id = m.id),
         s.id, s.source_type, s.source_id, s.source_version, s.excerpt, s.created_at
  FROM public.memory_items m
  LEFT JOIN public.context_field_policies p
    ON p.source_type = 'memory_item' AND p.source_id = m.id AND p.field_key = 'content'
  LEFT JOIN LATERAL (
    SELECT s.id, s.source_type, s.source_id, s.source_version, s.excerpt, s.created_at
    FROM public.memory_sources s
    WHERE s.memory_item_id = m.id
    ORDER BY s.created_at, s.id
    LIMIT 1
  ) s ON true
  WHERE m.owner_principal_id = v_user_id
    AND m.status = 'pending_confirmation'
    AND m.deleted_at IS NULL
    AND (
      p_cursor_created_at IS NULL
      OR (m.created_at, m.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT v_limit + 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_memory_for_use(
  p_use public.context_use,
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid
)
RETURNS TABLE (
  id uuid,
  kind public.memory_kind,
  title text,
  content text,
  structured_value jsonb,
  sensitivity public.sensitivity,
  status public.memory_status,
  version integer,
  valid_from timestamptz,
  valid_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  display_audience public.display_audience,
  discoverable boolean,
  allowed_uses text[],
  campus_id uuid,
  policy_version integer,
  source_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_use IS NULL THEN
    RAISE EXCEPTION 'memory use is required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT m.id, m.kind, m.title, m.content, m.structured_value, m.sensitivity,
         m.status, m.version, m.valid_from, m.valid_until, m.confirmed_at,
         m.created_at, m.updated_at,
         p.display_audience, p.discoverable, p.allowed_uses::text[],
         p.campus_id, p.version,
         (SELECT count(*)::integer FROM public.memory_sources s WHERE s.memory_item_id = m.id)
  FROM public.memory_items m
  JOIN public.context_field_policies p
    ON p.source_type = 'memory_item' AND p.source_id = m.id AND p.field_key = 'content'
  WHERE m.owner_principal_id = v_user_id
    AND m.status = 'confirmed'
    AND m.deleted_at IS NULL
    AND (m.valid_until IS NULL OR m.valid_until > now())
    AND p_use = ANY(p.allowed_uses)
    AND (
      p_cursor_created_at IS NULL
      OR (m.created_at, m.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT v_limit + 1;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.create_memory_candidate(
  public.memory_kind, text, text, jsonb, public.sensitivity,
  public.memory_source_type, uuid, text, text
) OWNER TO aven_function_owner;
ALTER FUNCTION app.confirm_memory_item(
  uuid, integer, public.memory_kind, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) OWNER TO aven_function_owner;
ALTER FUNCTION app.reject_memory_item(uuid, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_memory_candidates(integer, timestamptz, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_memory_for_use(
  public.context_use, integer, timestamptz, uuid
) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_memory_candidate(
  public.memory_kind, text, text, jsonb, public.sensitivity,
  public.memory_source_type, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_memory_item(
  uuid, integer, public.memory_kind, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_memory_item(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_memory_candidates(integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_memory_for_use(
  public.context_use, integer, timestamptz, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_memory_candidate(
  public.memory_kind, text, text, jsonb, public.sensitivity,
  public.memory_source_type, uuid, text, text
) TO aven_app;
GRANT EXECUTE ON FUNCTION app.confirm_memory_item(
  uuid, integer, public.memory_kind, text, text, jsonb, public.sensitivity,
  public.display_audience, boolean, public.context_use[], uuid, timestamptz
) TO aven_app;
GRANT EXECUTE ON FUNCTION app.reject_memory_item(uuid, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_memory_candidates(integer, timestamptz, uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_memory_for_use(
  public.context_use, integer, timestamptz, uuid
) TO aven_app;
