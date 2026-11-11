-- Fail closed until explicit availability sharing is implemented.
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'end_at must be strictly after start_at' USING ERRCODE = '22023';
  END IF;

  -- Cross-user availability remains closed until purpose-specific consent exists.
  IF p_principal_ids IS NULL OR EXISTS (
    SELECT 1 FROM unnest(p_principal_ids) AS requested(id)
    WHERE requested.id IS DISTINCT FROM v_user_id
  ) THEN
    RAISE EXCEPTION 'availability access denied' USING ERRCODE = '42501';
  END IF;

  -- The owner may query their own busy/free projection.
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

