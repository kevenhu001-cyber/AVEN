-- Platform configuration is accessible only through administrator-checked functions.
CREATE TABLE public.platform_configurations (
  kind text PRIMARY KEY CHECK (kind IN ('model', 'open_connector')),
  base_url text NOT NULL CHECK (length(base_url) BETWEEN 1 AND 2048),
  model text NOT NULL CHECK (length(model) <= 120),
  encrypted_key text NOT NULL CHECK (length(encrypted_key) BETWEEN 1 AND 8192),
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id)
);
ALTER TABLE public.platform_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_configurations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_configurations_functions ON public.platform_configurations TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY platform_configurations_migrator ON public.platform_configurations TO aven_migrator USING (true) WITH CHECK (true);
REVOKE ALL ON public.platform_configurations FROM PUBLIC, aven_app, aven_worker;
GRANT SELECT, INSERT, UPDATE ON public.platform_configurations TO aven_function_owner;

CREATE FUNCTION app.get_platform_configurations()
RETURNS TABLE(kind text, base_url text, model text, version integer, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF NOT app.is_platform_admin() THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.kind,p.base_url,p.model,p.version,p.updated_at FROM public.platform_configurations p;
END; $$;
CREATE FUNCTION app.save_platform_configuration(p_kind text,p_base_url text,p_model text,p_key text,p_version integer)
RETURNS TABLE(kind text,base_url text,model text,version integer,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE n integer;
BEGIN
  IF NOT app.is_platform_admin() THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
  IF p_version IS NULL OR p_version < 0 THEN RAISE EXCEPTION 'invalid version' USING ERRCODE='22023'; END IF;
  IF p_version=0 THEN
    INSERT INTO public.platform_configurations(kind,base_url,model,encrypted_key,version,updated_by)
    VALUES(p_kind,p_base_url,p_model,p_key,1,app.current_user_id()) ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.platform_configurations p SET base_url=p_base_url,model=p_model,encrypted_key=p_key,
      version=p.version+1,updated_at=now(),updated_by=app.current_user_id()
    WHERE p.kind=p_kind AND p.version=p_version;
  END IF;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'stale version' USING ERRCODE='P0005'; END IF;
  RETURN QUERY SELECT p.kind,p.base_url,p.model,p.version,p.updated_at FROM public.platform_configurations p WHERE p.kind=p_kind;
END; $$;
GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.get_platform_configurations() OWNER TO aven_function_owner;
ALTER FUNCTION app.save_platform_configuration(text,text,text,text,integer) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
REVOKE ALL ON FUNCTION app.get_platform_configurations() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_platform_configuration(text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_platform_configurations() TO aven_app;
GRANT EXECUTE ON FUNCTION app.save_platform_configuration(text,text,text,text,integer) TO aven_app;

-- Runtime reads only the connector configuration, never the model key.
CREATE FUNCTION app.get_open_connector_runtime()
RETURNS TABLE(base_url text, encrypted_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN RAISE EXCEPTION 'identity required' USING ERRCODE='28000'; END IF;
  RETURN QUERY SELECT p.base_url,p.encrypted_key FROM public.platform_configurations p WHERE p.kind='open_connector';
END; $$;
GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.get_open_connector_runtime() OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
REVOKE ALL ON FUNCTION app.get_open_connector_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_open_connector_runtime() TO aven_app;
