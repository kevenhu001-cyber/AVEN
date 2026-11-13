-- Bind personal runs to an immutable provider identity and version.
ALTER TABLE public.user_ai_providers ADD COLUMN config_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.agent_runs ADD COLUMN user_provider_config_id uuid;
ALTER TABLE public.agent_runs ADD COLUMN user_provider_version integer;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_run_user_provider_binding CHECK (
  (user_provider_config_id IS NULL AND user_provider_version IS NULL)
  OR (user_provider_config_id IS NOT NULL AND user_provider_version IS NOT NULL AND user_provider_version > 0)
);

CREATE FUNCTION app.get_user_ai_provider_metadata()
RETURNS TABLE(config_id uuid, base_url text, model text, version integer, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  RETURN QUERY SELECT p.config_id, p.base_url, p.model, p.version, p.updated_at FROM public.user_ai_providers p WHERE p.user_id = app.current_user_id();
END;
$$;
CREATE FUNCTION app.get_user_ai_provider_secret()
RETURNS TABLE(config_id uuid, base_url text, model text, encrypted_key text, version integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  RETURN QUERY SELECT p.config_id, p.base_url, p.model, p.encrypted_key, p.version FROM public.user_ai_providers p WHERE p.user_id = app.current_user_id();
END;
$$;
CREATE FUNCTION app.save_user_ai_provider_checked(p_url text, p_model text, p_key text, p_version integer, p_config_id uuid)
RETURNS TABLE(config_id uuid, base_url text, model text, version integer, updated_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app.current_user_id() IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  SELECT p.config_id INTO v_id FROM public.user_ai_providers p WHERE p.user_id = app.current_user_id() FOR UPDATE;
  IF v_id IS DISTINCT FROM p_config_id THEN RAISE EXCEPTION 'stale provider identity' USING ERRCODE = 'P0005'; END IF;
  PERFORM app.save_user_ai_provider(p_url, p_model, p_key, p_version);
  RETURN QUERY SELECT * FROM app.get_user_ai_provider_metadata();
END;
$$;
CREATE FUNCTION app.delete_user_ai_provider_checked(p_version integer, p_config_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF app.current_user_id() IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  SELECT p.config_id INTO v_id FROM public.user_ai_providers p WHERE p.user_id = app.current_user_id() FOR UPDATE;
  IF v_id IS NULL THEN RETURN false; END IF;
  IF v_id IS DISTINCT FROM p_config_id THEN RAISE EXCEPTION 'stale provider identity' USING ERRCODE = 'P0005'; END IF;
  RETURN app.delete_user_ai_provider(p_version);
END;
$$;
CREATE FUNCTION app.create_personal_agent_turn(p_key text, p_method text, p_path text, p_hash text, p_conversation uuid, p_input text, p_provider text, p_model text)
RETURNS TABLE(run_id uuid, conversation_id uuid, status public.agent_run_status, created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE v_cfg public.user_ai_providers%ROWTYPE; v_turn record;
BEGIN
  IF app.current_user_id() IS NULL THEN RAISE EXCEPTION 'no user context' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cfg FROM public.user_ai_providers p WHERE p.user_id = app.current_user_id() FOR SHARE;
  IF FOUND THEN p_provider := 'user_openai_compatible'; p_model := v_cfg.model; END IF;
  SELECT * INTO v_turn FROM app.create_agent_turn(p_key, p_method, p_path, p_hash, p_conversation, p_input, p_provider, p_model);
  IF v_turn.created AND v_cfg.config_id IS NOT NULL THEN
    UPDATE public.agent_runs r SET user_provider_config_id = v_cfg.config_id, user_provider_version = v_cfg.version WHERE r.id = v_turn.run_id;
  END IF;
  RETURN QUERY SELECT v_turn.run_id, v_turn.conversation_id, v_turn.status, v_turn.created;
END;
$$;
CREATE FUNCTION app.get_agent_run_user_provider(p_run_id uuid)
RETURNS TABLE(user_id uuid, config_id uuid, base_url text, model text, encrypted_key text, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
 SELECT p.user_id, p.config_id, p.base_url, p.model, p.encrypted_key, p.version
 FROM public.agent_runs r JOIN public.user_ai_providers p ON p.user_id = r.initiated_by_user_id
 WHERE r.id = p_run_id AND r.principal_id = r.initiated_by_user_id AND r.provider = 'user_openai_compatible'
   AND r.status IN ('queued', 'running') AND r.user_provider_config_id = p.config_id
   AND r.user_provider_version = p.version AND r.model = p.model;
$$;
GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.get_user_ai_provider_metadata() OWNER TO aven_function_owner;
ALTER FUNCTION app.get_user_ai_provider_secret() OWNER TO aven_function_owner;
ALTER FUNCTION app.save_user_ai_provider_checked(text,text,text,integer,uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.delete_user_ai_provider_checked(integer,uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.create_personal_agent_turn(text,text,text,text,uuid,text,text,text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_agent_run_user_provider(uuid) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;
REVOKE ALL ON FUNCTION app.get_user_ai_provider_metadata(), app.get_user_ai_provider_secret(), app.save_user_ai_provider_checked(text,text,text,integer,uuid), app.delete_user_ai_provider_checked(integer,uuid), app.create_personal_agent_turn(text,text,text,text,uuid,text,text,text), app.get_agent_run_user_provider(uuid) FROM PUBLIC, aven_app, aven_worker;
GRANT EXECUTE ON FUNCTION app.get_user_ai_provider_metadata(), app.get_user_ai_provider_secret(), app.save_user_ai_provider_checked(text,text,text,integer,uuid), app.delete_user_ai_provider_checked(integer,uuid), app.create_personal_agent_turn(text,text,text,text,uuid,text,text,text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_agent_run_user_provider(uuid) TO aven_worker;
