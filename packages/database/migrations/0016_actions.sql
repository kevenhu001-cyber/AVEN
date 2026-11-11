-- M3-06: action drafts, preview, one-time confirmation, and idempotent execution.

CREATE TYPE public.action_status AS ENUM (
  'draft', 'pending_confirmation', 'executing', 'succeeded', 'failed', 'cancelled', 'expired'
);

CREATE TABLE public.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.agent_runs (id) ON DELETE SET NULL,
  principal_id uuid NOT NULL REFERENCES public.users (id),
  organization_id uuid REFERENCES public.organizations (id),
  action_type text NOT NULL,
  draft_version integer NOT NULL DEFAULT 1,
  draft_payload jsonb NOT NULL,
  status public.action_status NOT NULL DEFAULT 'pending_confirmation',
  confirmation_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_actions_type CHECK (length(trim(action_type)) BETWEEN 1 AND 80),
  CONSTRAINT chk_actions_version CHECK (draft_version >= 1),
  CONSTRAINT chk_actions_payload CHECK (jsonb_typeof(draft_payload) = 'object'),
  CONSTRAINT chk_actions_token CHECK (length(confirmation_token_hash) = 64),
  CONSTRAINT chk_actions_result CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CONSTRAINT chk_actions_terminal CHECK (
    status <> 'succeeded'
    OR (confirmed_at IS NOT NULL AND executed_at IS NOT NULL AND result IS NOT NULL)
  )
);
CREATE INDEX idx_actions_principal_status
  ON public.actions (principal_id, status, created_at DESC);
CREATE INDEX idx_actions_expires ON public.actions (expires_at);

CREATE TRIGGER trg_actions_updated_at
BEFORE UPDATE ON public.actions
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions FORCE ROW LEVEL SECURITY;

CREATE POLICY actions_owner_select ON public.actions
FOR SELECT TO aven_app
USING (principal_id = app.current_principal_id());
CREATE POLICY actions_function_all ON public.actions
FOR ALL TO aven_function_owner USING (true) WITH CHECK (true);
CREATE POLICY actions_migrator_all ON public.actions
FOR ALL TO aven_migrator USING (true) WITH CHECK (true);

GRANT SELECT ON public.actions TO aven_app;
GRANT SELECT, INSERT, UPDATE ON public.actions TO aven_function_owner;

CREATE OR REPLACE FUNCTION app.create_action(
  p_action_type text,
  p_payload jsonb,
  p_run_id uuid,
  p_expires_in_seconds integer,
  p_token_hash text
)
RETURNS TABLE (
  id uuid,
  action_type text,
  status public.action_status,
  draft_version integer,
  run_id uuid,
  organization_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_action_id uuid;
  v_expires integer := greatest(1, least(coalesce(p_expires_in_seconds, 600), 3600));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_action_type IS NULL OR p_action_type <> 'memory.create' THEN
    RAISE EXCEPTION 'unsupported action type' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid action payload' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid confirmation token hash' USING ERRCODE = '22023';
  END IF;
  IF p_run_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_runs r
      WHERE r.id = p_run_id AND r.initiated_by_user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'agent run not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.actions
    (run_id, principal_id, organization_id, action_type, draft_version,
     draft_payload, status, confirmation_token_hash, expires_at)
  VALUES
    (p_run_id, v_user_id, NULL, p_action_type, 1, p_payload,
     'pending_confirmation', p_token_hash, now() + make_interval(secs => v_expires))
  RETURNING id INTO v_action_id;

  RETURN QUERY
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
         a.created_at, a.updated_at
  FROM public.actions a WHERE a.id = v_action_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_action(p_action_id uuid)
RETURNS TABLE (
  id uuid,
  action_type text,
  status public.action_status,
  draft_version integer,
  run_id uuid,
  organization_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
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
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
         a.created_at, a.updated_at
  FROM public.actions a
  WHERE a.id = p_action_id AND a.principal_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.confirm_memory_create_action(
  p_action_id uuid,
  p_expected_draft_version integer,
  p_token_hash text,
  p_idempotency_key text,
  p_method text,
  p_path text,
  p_request_hash text
)
RETURNS TABLE (
  id uuid,
  action_type text,
  status public.action_status,
  draft_version integer,
  run_id uuid,
  organization_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  executed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_action public.actions%ROWTYPE;
  v_existing public.idempotency_keys%ROWTYPE;
  v_memory_id uuid;
  v_kind public.memory_kind;
  v_title text;
  v_content text;
  v_structured jsonb;
  v_sensitivity public.sensitivity;
  v_audience public.display_audience;
  v_discoverable boolean;
  v_uses public.context_use[];
  v_campus uuid;
  v_valid_until timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.idempotency_keys k
  WHERE k.principal_id = v_user_id
    AND k.key = p_idempotency_key
    AND k.method = p_method
    AND k.path = p_path
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different request'
        USING ERRCODE = 'P0003';
    END IF;
    IF v_existing.expires_at > now() AND v_existing.result_resource_id IS NOT NULL THEN
      SELECT * INTO v_action
      FROM public.actions a
      WHERE a.id = v_existing.result_resource_id AND a.principal_id = v_user_id;
      IF v_action.id IS NOT NULL THEN
        RETURN QUERY
        SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
               a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
               a.created_at, a.updated_at, false
        FROM public.actions a WHERE a.id = v_action.id;
        RETURN;
      END IF;
    END IF;
    DELETE FROM public.idempotency_keys WHERE id = v_existing.id;
  END IF;

  SELECT * INTO v_action
  FROM public.actions a
  WHERE a.id = p_action_id AND a.principal_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_action.confirmation_token_hash <> p_token_hash THEN
    RAISE EXCEPTION 'action confirmation token is invalid' USING ERRCODE = 'P0004';
  END IF;

  IF v_action.status = 'succeeded' THEN
    INSERT INTO public.idempotency_keys
      (principal_id, key, method, path, request_hash, response_status, state,
       result_resource_id, response_body, expires_at)
    VALUES
      (v_user_id, p_idempotency_key, p_method, p_path, p_request_hash, 200, 'completed',
       v_action.id, jsonb_build_object('action_id', v_action.id), now() + interval '24 hours')
    ON CONFLICT (principal_id, key, method, path) DO NOTHING;
    RETURN QUERY
    SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
           a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
           a.created_at, a.updated_at, false
    FROM public.actions a WHERE a.id = v_action.id;
    RETURN;
  END IF;

  IF v_action.status <> 'pending_confirmation' THEN
    RETURN QUERY
    SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
           a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
           a.created_at, a.updated_at, false
    FROM public.actions a WHERE a.id = v_action.id;
    RETURN;
  END IF;

  IF v_action.draft_version <> p_expected_draft_version THEN
    RAISE EXCEPTION 'action draft version conflict' USING ERRCODE = 'P0005';
  END IF;

  IF v_action.expires_at <= now() THEN
    UPDATE public.actions SET status = 'expired', updated_at = now() WHERE id = v_action.id;
    RETURN QUERY
    SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
           a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
           a.created_at, a.updated_at, false
    FROM public.actions a WHERE a.id = v_action.id;
    RETURN;
  END IF;

  IF v_action.action_type <> 'memory.create' THEN
    RAISE EXCEPTION 'unsupported action type' USING ERRCODE = '22023';
  END IF;

  v_kind := (v_action.draft_payload ->> 'kind')::public.memory_kind;
  v_title := v_action.draft_payload ->> 'title';
  v_content := v_action.draft_payload ->> 'content';
  v_structured := v_action.draft_payload -> 'structuredValue';
  v_sensitivity := (v_action.draft_payload ->> 'sensitivity')::public.sensitivity;
  v_audience := (v_action.draft_payload ->> 'displayAudience')::public.display_audience;
  v_discoverable := coalesce((v_action.draft_payload ->> 'discoverable')::boolean, false);
  v_uses := ARRAY(
    SELECT jsonb_array_elements_text(v_action.draft_payload -> 'allowedUses')
  )::public.context_use[];
  v_campus := (v_action.draft_payload ->> 'campusId')::uuid;
  v_valid_until := (v_action.draft_payload ->> 'validUntil')::timestamptz;

  v_memory_id := app.create_memory_item(
    v_kind, v_title, v_content, v_structured, v_sensitivity, v_audience,
    v_discoverable, v_uses, v_campus, v_valid_until
  );

  UPDATE public.actions
  SET status = 'succeeded',
      confirmed_at = now(),
      executed_at = now(),
      result = jsonb_build_object('memoryId', v_memory_id),
      updated_at = now()
  WHERE id = v_action.id;

  INSERT INTO public.idempotency_keys
    (principal_id, key, method, path, request_hash, response_status, state,
     result_resource_id, response_body, expires_at)
  VALUES
    (v_user_id, p_idempotency_key, p_method, p_path, p_request_hash, 200, 'completed',
     v_action.id, jsonb_build_object('action_id', v_action.id), now() + interval '24 hours')
  ON CONFLICT (principal_id, key, method, path) DO NOTHING;

  RETURN QUERY
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
         a.created_at, a.updated_at, true
  FROM public.actions a WHERE a.id = v_action.id;
END;
$$;

CREATE OR REPLACE FUNCTION app.cancel_action(
  p_action_id uuid,
  p_idempotency_key text,
  p_method text,
  p_path text,
  p_request_hash text
)
RETURNS TABLE (
  id uuid,
  action_type text,
  status public.action_status,
  draft_version integer,
  run_id uuid,
  organization_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  accepted boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_user_id uuid := app.current_user_id();
  v_action public.actions%ROWTYPE;
  v_existing public.idempotency_keys%ROWTYPE;
  v_accepted boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user context' USING ERRCODE = '28000';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.idempotency_keys k
  WHERE k.principal_id = v_user_id
    AND k.key = p_idempotency_key
    AND k.method = p_method
    AND k.path = p_path
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different request'
        USING ERRCODE = 'P0003';
    END IF;
    IF v_existing.expires_at > now() AND v_existing.result_resource_id IS NOT NULL THEN
      SELECT * INTO v_action
      FROM public.actions a
      WHERE a.id = v_existing.result_resource_id AND a.principal_id = v_user_id;
      IF v_action.id IS NOT NULL THEN
        RETURN QUERY
        SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
               a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
               a.created_at, a.updated_at, false
        FROM public.actions a WHERE a.id = v_action.id;
        RETURN;
      END IF;
    END IF;
    DELETE FROM public.idempotency_keys WHERE id = v_existing.id;
  END IF;

  SELECT * INTO v_action
  FROM public.actions a
  WHERE a.id = p_action_id AND a.principal_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_action.status = 'pending_confirmation' THEN
    UPDATE public.actions SET status = 'cancelled', updated_at = now() WHERE id = v_action.id;
    v_accepted := true;
  END IF;

  INSERT INTO public.idempotency_keys
    (principal_id, key, method, path, request_hash, response_status, state,
     result_resource_id, response_body, expires_at)
  VALUES
    (v_user_id, p_idempotency_key, p_method, p_path, p_request_hash, 200, 'completed',
     v_action.id, jsonb_build_object('action_id', v_action.id), now() + interval '24 hours')
  ON CONFLICT (principal_id, key, method, path) DO NOTHING;

  RETURN QUERY
  SELECT a.id, a.action_type, a.status, a.draft_version, a.run_id, a.organization_id,
         a.draft_payload, a.expires_at, a.confirmed_at, a.executed_at, a.result,
         a.created_at, a.updated_at, v_accepted
  FROM public.actions a WHERE a.id = v_action.id;
END;
$$;

GRANT CREATE ON SCHEMA app TO aven_function_owner;
ALTER FUNCTION app.create_action(text, jsonb, uuid, integer, text) OWNER TO aven_function_owner;
ALTER FUNCTION app.get_action(uuid) OWNER TO aven_function_owner;
ALTER FUNCTION app.confirm_memory_create_action(
  uuid, integer, text, text, text, text, text
) OWNER TO aven_function_owner;
ALTER FUNCTION app.cancel_action(uuid, text, text, text, text) OWNER TO aven_function_owner;
REVOKE CREATE ON SCHEMA app FROM aven_function_owner;

REVOKE ALL ON FUNCTION app.create_action(text, jsonb, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_action(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_memory_create_action(
  uuid, integer, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.cancel_action(uuid, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_action(text, jsonb, uuid, integer, text) TO aven_app;
GRANT EXECUTE ON FUNCTION app.get_action(uuid) TO aven_app;
GRANT EXECUTE ON FUNCTION app.confirm_memory_create_action(
  uuid, integer, text, text, text, text, text
) TO aven_app;
GRANT EXECUTE ON FUNCTION app.cancel_action(uuid, text, text, text, text) TO aven_app;
