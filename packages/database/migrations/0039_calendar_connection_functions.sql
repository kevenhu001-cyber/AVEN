-- Migration: 0039_calendar_connection_functions
-- M6-02: Stored functions for encrypted external calendar OAuth connections,
-- incremental busy/free sync cursors, error recovery state, and atomic revocation.

CREATE OR REPLACE FUNCTION app.upsert_calendar_connection(
  p_provider text,
  p_credentials_ciphertext text,
  p_key_version integer DEFAULT 1,
  p_status text DEFAULT 'active'
) RETURNS TABLE (
  id uuid,
  principal_id uuid,
  provider text,
  key_version integer,
  sync_cursor text,
  status text,
  last_synced_at timestamptz,
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
  v_now timestamptz := clock_timestamp();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF p_provider NOT IN ('google_calendar', 'microsoft_outlook', 'feishu_calendar', 'caldav_ics') THEN
    RAISE EXCEPTION 'unsupported calendar provider' USING ERRCODE = '22023';
  END IF;

  IF p_status NOT IN ('active', 'revoked', 'sync_error', 'reauth_required') THEN
    RAISE EXCEPTION 'invalid calendar connection status' USING ERRCODE = '22023';
  END IF;

  IF p_credentials_ciphertext IS NULL OR length(trim(p_credentials_ciphertext)) = 0 THEN
    RAISE EXCEPTION 'encrypted credentials required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.calendar_connections (
    principal_id,
    provider,
    credentials_ciphertext,
    key_version,
    sync_cursor,
    status,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    p_provider,
    p_credentials_ciphertext,
    coalesce(p_key_version, 1),
    NULL,
    p_status,
    v_now,
    v_now
  )
  ON CONFLICT (principal_id, provider) DO UPDATE
  SET
    credentials_ciphertext = EXCLUDED.credentials_ciphertext,
    key_version = EXCLUDED.key_version,
    sync_cursor = CASE
      WHEN calendar_connections.status = 'revoked' THEN NULL
      ELSE calendar_connections.sync_cursor
    END,
    status = EXCLUDED.status,
    updated_at = v_now
  RETURNING calendar_connections.id INTO v_id;

  RETURN QUERY
  SELECT
    cc.id,
    cc.principal_id,
    cc.provider,
    cc.key_version,
    cc.sync_cursor,
    cc.status,
    cc.last_synced_at,
    cc.created_at,
    cc.updated_at
  FROM public.calendar_connections cc
  WHERE cc.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_calendar_connections()
RETURNS TABLE (
  id uuid,
  principal_id uuid,
  provider text,
  key_version integer,
  sync_cursor text,
  status text,
  last_synced_at timestamptz,
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
    cc.id,
    cc.principal_id,
    cc.provider,
    cc.key_version,
    cc.sync_cursor,
    cc.status,
    cc.last_synced_at,
    cc.created_at,
    cc.updated_at
  FROM public.calendar_connections cc
  WHERE cc.principal_id = v_user_id
  ORDER BY cc.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_calendar_connection_for_sync(
  p_provider text
) RETURNS TABLE (
  id uuid,
  principal_id uuid,
  provider text,
  credentials_ciphertext text,
  key_version integer,
  sync_cursor text,
  status text,
  last_synced_at timestamptz
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
    cc.id,
    cc.principal_id,
    cc.provider,
    cc.credentials_ciphertext,
    cc.key_version,
    cc.sync_cursor,
    cc.status,
    cc.last_synced_at
  FROM public.calendar_connections cc
  WHERE cc.principal_id = v_user_id
    AND cc.provider = p_provider;
END;
$$;

CREATE OR REPLACE FUNCTION app.update_calendar_connection_state(
  p_provider text,
  p_status text,
  p_credentials_ciphertext text DEFAULT NULL,
  p_key_version integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('active', 'revoked', 'sync_error', 'reauth_required') THEN
    RAISE EXCEPTION 'invalid calendar connection status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.calendar_connections cc
  SET
    status = p_status,
    credentials_ciphertext = coalesce(p_credentials_ciphertext, cc.credentials_ciphertext),
    key_version = coalesce(p_key_version, cc.key_version),
    updated_at = v_now
  WHERE cc.principal_id = v_user_id
    AND cc.provider = p_provider;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar connection not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app.apply_calendar_sync_delta(
  p_provider text,
  p_next_cursor text,
  p_blocks_json jsonb,
  p_replace_existing boolean DEFAULT true
) RETURNS TABLE (
  imported_count integer,
  deleted_count integer,
  next_cursor text,
  last_synced_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_now timestamptz := clock_timestamp();
  v_conn public.calendar_connections%ROWTYPE;
  v_source text := 'oauth:' || p_provider;
  v_deleted integer := 0;
  v_imported integer := 0;
  v_item jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_tz text;
  v_status public.availability_status;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_conn
  FROM public.calendar_connections cc
  WHERE cc.principal_id = v_user_id
    AND cc.provider = p_provider
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar connection not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conn.status = 'revoked' THEN
    RAISE EXCEPTION 'calendar connection is revoked' USING ERRCODE = '42501';
  END IF;

  IF coalesce(p_replace_existing, true) THEN
    WITH removed AS (
      DELETE FROM public.availability_blocks ab
      WHERE ab.principal_id = v_user_id
        AND ab.source = v_source
      RETURNING ab.id
    )
    SELECT count(*)::integer INTO v_deleted FROM removed;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(coalesce(p_blocks_json, '[]'::jsonb))
  LOOP
    v_start := (v_item->>'startAt')::timestamptz;
    v_end := (v_item->>'endAt')::timestamptz;
    v_tz := coalesce(nullif(v_item->>'timezone', ''), 'Asia/Shanghai');
    v_status := coalesce((v_item->>'status')::public.availability_status, 'busy');

    IF v_end <= v_start THEN
      RAISE EXCEPTION 'synced block endAt must be after startAt' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.availability_blocks (
      principal_id,
      start_at,
      end_at,
      timezone,
      status,
      source,
      version,
      created_at,
      updated_at
    ) VALUES (
      v_user_id,
      v_start,
      v_end,
      v_tz,
      v_status,
      v_source,
      1,
      v_now,
      v_now
    );
    v_imported := v_imported + 1;
  END LOOP;

  UPDATE public.calendar_connections cc
  SET
    sync_cursor = p_next_cursor,
    status = 'active',
    last_synced_at = v_now,
    updated_at = v_now
  WHERE cc.id = v_conn.id;

  RETURN QUERY
  SELECT v_imported, v_deleted, p_next_cursor, v_now;
END;
$$;

CREATE OR REPLACE FUNCTION app.revoke_calendar_connection(
  p_provider text
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := app.current_user_id();
  v_now timestamptz := clock_timestamp();
  v_source text := 'oauth:' || p_provider;
  v_deleted integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  UPDATE public.calendar_connections cc
  SET
    status = 'revoked',
    credentials_ciphertext = '[REVOKED]',
    sync_cursor = NULL,
    updated_at = v_now
  WHERE cc.principal_id = v_user_id
    AND cc.provider = p_provider;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar connection not found' USING ERRCODE = 'P0002';
  END IF;

  WITH removed AS (
    DELETE FROM public.availability_blocks ab
    WHERE ab.principal_id = v_user_id
      AND ab.source = v_source
    RETURNING ab.id
  )
  SELECT count(*)::integer INTO v_deleted FROM removed;

  RETURN v_deleted;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.upsert_calendar_connection(text, text, integer, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_calendar_connections() OWNER TO aven_function_owner;
ALTER FUNCTION app.get_calendar_connection_for_sync(text) OWNER TO aven_function_owner;
ALTER FUNCTION app.update_calendar_connection_state(text, text, text, integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.apply_calendar_sync_delta(text, text, jsonb, boolean) OWNER TO aven_function_owner;
ALTER FUNCTION app.revoke_calendar_connection(text) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.upsert_calendar_connection(text, text, integer, text) FROM public;
REVOKE ALL ON FUNCTION app.list_calendar_connections() FROM public;
REVOKE ALL ON FUNCTION app.get_calendar_connection_for_sync(text) FROM public;
REVOKE ALL ON FUNCTION app.update_calendar_connection_state(text, text, text, integer) FROM public;
REVOKE ALL ON FUNCTION app.apply_calendar_sync_delta(text, text, jsonb, boolean) FROM public;
REVOKE ALL ON FUNCTION app.revoke_calendar_connection(text) FROM public;

GRANT EXECUTE ON FUNCTION app.upsert_calendar_connection(text, text, integer, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_calendar_connections() TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_calendar_connection_for_sync(text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.update_calendar_connection_state(text, text, text, integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.apply_calendar_sync_delta(text, text, jsonb, boolean) TO aven_app;
GRANT EXECUTE ON FUNCTION app.revoke_calendar_connection(text) TO aven_app;
