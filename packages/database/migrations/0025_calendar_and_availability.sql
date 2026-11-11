-- Migration: 0025_calendar_and_availability
-- M6: Calendar Connections and Availability Blocks

CREATE TYPE public.availability_status AS ENUM ('busy', 'tentative', 'free');

CREATE TABLE public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES public.principals (id) ON DELETE CASCADE,
  provider text NOT NULL,
  credentials_ciphertext text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  sync_cursor text,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_calendar_connection_provider UNIQUE (principal_id, provider)
);

CREATE INDEX idx_calendar_connections_principal ON public.calendar_connections (principal_id);

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_connections_function_all ON public.calendar_connections
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY calendar_connections_migrator_all ON public.calendar_connections
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY calendar_connections_owner_select ON public.calendar_connections
  FOR SELECT TO aven_app
  USING (principal_id = app.current_principal_id());
ALTER TABLE public.calendar_connections FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.calendar_connections TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_connections TO aven_function_owner;

-- Availability Blocks
CREATE TABLE public.availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES public.principals (id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  status public.availability_status NOT NULL DEFAULT 'busy',
  source text NOT NULL DEFAULT 'manual',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_avail_time CHECK (end_at > start_at)
);

CREATE INDEX idx_availability_blocks_principal_time ON public.availability_blocks (principal_id, start_at, end_at);

ALTER TABLE public.availability_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_blocks_function_all ON public.availability_blocks
  FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY availability_blocks_migrator_all ON public.availability_blocks
  FOR ALL TO aven_migrator USING (true) WITH CHECK (true);
CREATE POLICY availability_blocks_owner_select ON public.availability_blocks
  FOR SELECT TO aven_app
  USING (principal_id = app.current_principal_id());
ALTER TABLE public.availability_blocks FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.availability_blocks TO aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_blocks TO aven_function_owner;

-- Stored Functions for Availability Management

CREATE OR REPLACE FUNCTION app.upsert_availability_block(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_timezone text DEFAULT 'Asia/Shanghai',
  p_status public.availability_status DEFAULT 'busy',
  p_source text DEFAULT 'manual',
  p_block_id uuid DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  principal_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  status public.availability_status,
  source text,
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
  v_now timestamptz := clock_timestamp();
  v_id uuid;
  v_version integer := 1;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;

  IF p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'end_at must be strictly after start_at' USING ERRCODE = '22023';
  END IF;

  IF p_block_id IS NOT NULL THEN
    UPDATE public.availability_blocks
    SET
      start_at = p_start_at,
      end_at = p_end_at,
      timezone = coalesce(p_timezone, availability_blocks.timezone),
      status = coalesce(p_status, availability_blocks.status),
      source = coalesce(p_source, availability_blocks.source),
      version = availability_blocks.version + 1,
      updated_at = v_now
    WHERE availability_blocks.id = p_block_id
      AND availability_blocks.principal_id = v_user_id
    RETURNING availability_blocks.id, availability_blocks.version INTO v_id, v_version;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'availability block not found or access denied' USING ERRCODE = 'P0002';
    END IF;
  ELSE
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
      p_start_at,
      p_end_at,
      coalesce(p_timezone, 'Asia/Shanghai'),
      coalesce(p_status, 'busy'),
      coalesce(p_source, 'manual'),
      1,
      v_now,
      v_now
    )
    RETURNING availability_blocks.id, availability_blocks.version INTO v_id, v_version;
  END IF;

  RETURN QUERY
  SELECT
    ab.id,
    ab.principal_id,
    ab.start_at,
    ab.end_at,
    ab.timezone,
    ab.status,
    ab.source,
    ab.version,
    ab.created_at,
    ab.updated_at
  FROM public.availability_blocks ab
  WHERE ab.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.delete_availability_block(
  p_block_id uuid
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
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

  DELETE FROM public.availability_blocks
  WHERE id = p_block_id
    AND principal_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'availability block not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$$;

-- Privacy-Preserving Busy/Free Projection Query
-- Strictly returns ONLY busy windows without revealing event titles or sensitive notes
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

  -- Filter to requested principals and time overlapping window
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

CREATE OR REPLACE FUNCTION app.list_my_availability_blocks(
  p_start_at timestamptz,
  p_end_at timestamptz
) RETURNS TABLE (
  id uuid,
  principal_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  status public.availability_status,
  source text,
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
    ab.id,
    ab.principal_id,
    ab.start_at,
    ab.end_at,
    ab.timezone,
    ab.status,
    ab.source,
    ab.version,
    ab.created_at,
    ab.updated_at
  FROM public.availability_blocks ab
  WHERE ab.principal_id = v_user_id
    AND ab.start_at < p_end_at
    AND ab.end_at > p_start_at
  ORDER BY ab.start_at ASC;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.upsert_availability_block(timestamptz, timestamptz, text, public.availability_status, text, uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.delete_availability_block(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.query_availability_window(uuid[], timestamptz, timestamptz) OWNER TO aven_function_owner;
ALTER FUNCTION app.list_my_availability_blocks(timestamptz, timestamptz) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.upsert_availability_block FROM public;
REVOKE ALL ON FUNCTION app.delete_availability_block FROM public;
REVOKE ALL ON FUNCTION app.query_availability_window FROM public;
REVOKE ALL ON FUNCTION app.list_my_availability_blocks FROM public;

GRANT EXECUTE ON FUNCTION app.upsert_availability_block TO aven_app;
GRANT EXECUTE ON FUNCTION app.delete_availability_block TO aven_app;
GRANT EXECUTE ON FUNCTION app.query_availability_window TO aven_app;
GRANT EXECUTE ON FUNCTION app.list_my_availability_blocks TO aven_app;
