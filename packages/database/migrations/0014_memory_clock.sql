-- Use wall-clock time for memory expiry and use-scoped retrieval.
-- `now()` is transaction start time; a long-running maintenance transaction
-- must still see memories whose validity elapsed during the transaction.

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
    AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
    AND p_use = ANY(p.allowed_uses)
    AND (
      p_cursor_created_at IS NULL
      OR (m.created_at, m.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT v_limit + 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.expire_due_memories(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 1000));
  v_count integer := 0;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT m.id
    FROM public.memory_items m
    WHERE m.status = 'confirmed'
      AND m.valid_until IS NOT NULL
      AND m.valid_until <= clock_timestamp()
    ORDER BY m.valid_until, m.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.memory_items
    SET status = 'expired', version = version + 1, updated_at = now()
    WHERE id = v_row.id;
    UPDATE public.context_field_policies
    SET allowed_uses = '{}', discoverable = false, version = version + 1, updated_at = now()
    WHERE source_type = 'memory_item' AND source_id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
