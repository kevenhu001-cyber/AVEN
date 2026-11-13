-- Migration: 0043_agent_provider_runtime
-- Real AI provider resolution for the agent runtime.
--
-- The API records the effective provider/model on each run. The Worker reads the
-- encrypted key material for that run's user and decrypts it in-process, so a
-- configured user or platform provider is used instead of the environment mock.
-- Plaintext keys never leave the Worker process.

CREATE FUNCTION app.get_effective_ai_provider()
RETURNS TABLE(source text, base_url text, model text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
    SELECT 'user'::text, p.base_url, p.model
      FROM public.user_ai_providers p
      WHERE p.user_id = v_user_id
    UNION ALL
    SELECT 'platform'::text, c.base_url, c.model
      FROM public.platform_configurations c
      WHERE c.kind = 'model'
    LIMIT 1;
END;
$$;

CREATE FUNCTION app.get_agent_provider_runtime(p_user_id uuid)
RETURNS TABLE(source text, base_url text, model text, encrypted_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT 'user'::text, p.base_url, p.model, p.encrypted_key
      FROM public.user_ai_providers p
      WHERE p.user_id = p_user_id
    UNION ALL
    SELECT 'platform'::text, c.base_url, c.model, c.encrypted_key
      FROM public.platform_configurations c
      WHERE c.kind = 'model'
    LIMIT 1;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.get_effective_ai_provider() OWNER TO aven_function_owner;
ALTER FUNCTION app.get_agent_provider_runtime(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.get_effective_ai_provider() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_agent_provider_runtime(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_effective_ai_provider() TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_agent_provider_runtime(uuid) TO aven_worker;
