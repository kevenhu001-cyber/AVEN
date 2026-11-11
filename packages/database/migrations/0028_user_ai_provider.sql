-- User-owned encrypted provider settings. Keys are never readable by app roles.
CREATE TABLE public.user_ai_providers (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  base_url text NOT NULL CHECK (length(base_url) BETWEEN 1 AND 2048),
  model text NOT NULL CHECK (length(trim(model)) BETWEEN 1 AND 120),
  encrypted_key text NOT NULL CHECK (length(encrypted_key) BETWEEN 1 AND 4096),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ai_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY user_ai_providers_function_all ON public.user_ai_providers
  TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY user_ai_providers_migrator_all ON public.user_ai_providers
  TO aven_migrator USING (true) WITH CHECK (true);
REVOKE ALL ON public.user_ai_providers FROM PUBLIC, aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_providers TO aven_function_owner;

CREATE FUNCTION app.get_user_ai_provider()
RETURNS TABLE(base_url text, model text, version integer, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE v_user_id uuid := app.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  RETURN QUERY SELECT p.base_url, p.model, p.version, p.updated_at
    FROM public.user_ai_providers p WHERE p.user_id = v_user_id;
END;
$$;

CREATE FUNCTION app.save_user_ai_provider(p_base_url text, p_model text, p_encrypted_key text, p_expected_version integer)
RETURNS TABLE(base_url text, model text, version integer, updated_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE v_user_id uuid := app.current_user_id(); v_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'invalid version' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version = 0 THEN
    INSERT INTO public.user_ai_providers(user_id, base_url, model, encrypted_key)
    VALUES(v_user_id, p_base_url, p_model, p_encrypted_key) ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.user_ai_providers p SET base_url = p_base_url, model = p_model,
      encrypted_key = p_encrypted_key, version = p.version + 1, updated_at = now()
    WHERE p.user_id = v_user_id AND p.version = p_expected_version;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'stale version' USING ERRCODE = 'P0005'; END IF;
  RETURN QUERY SELECT p.base_url, p.model, p.version, p.updated_at
    FROM public.user_ai_providers p WHERE p.user_id = v_user_id;
END;
$$;

CREATE FUNCTION app.delete_user_ai_provider(p_expected_version integer)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE v_user_id uuid := app.current_user_id(); v_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.user_ai_providers p WHERE p.user_id = v_user_id AND p.version = p_expected_version;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 AND EXISTS (SELECT 1 FROM public.user_ai_providers p WHERE p.user_id = v_user_id) THEN
    RAISE EXCEPTION 'stale version' USING ERRCODE = 'P0005';
  END IF;
  RETURN v_count = 1;
END;
$$;
GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.get_user_ai_provider() OWNER TO aven_function_owner;
ALTER FUNCTION app.save_user_ai_provider(text,text,text,integer) OWNER TO aven_function_owner;
ALTER FUNCTION app.delete_user_ai_provider(integer) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
REVOKE ALL ON FUNCTION app.get_user_ai_provider() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_user_ai_provider(text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.delete_user_ai_provider(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_user_ai_provider() TO aven_app;
GRANT EXECUTE ON FUNCTION app.save_user_ai_provider(text,text,text,integer) TO aven_app;
GRANT EXECUTE ON FUNCTION app.delete_user_ai_provider(integer) TO aven_app;
